import AppKit
import ArgusUI
import ImageIO
import SwiftUI

/// The session's Conductor-driven Chromium: its JPEG screencast, an address
/// bar, and pointer, wheel and keys forwarded in viewport pixels — the
/// renderer's `WebBrowserView`.
struct RuntimeBrowserView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime
  /// The session id, or the global key when no session is open.
  let sessionKey: String

  @State private var frame = RuntimeJpegView.Handle()
  @State private var inputUrl = ""
  @State private var canGoBack = false
  @State private var canGoForward = false
  @State private var receiving = false
  @State private var stageSize = CGSize.zero
  @State private var detach: (() -> Void)?
  @State private var stopNav: (() -> Void)?

  private static let fallbackUrl = "https://houwert.dev/argus"

  private var customPresets: [BrowserPreset] {
    BrowserPreset.custom(runtime.projectConfig?.browserPresets ?? [])
  }

  private var preset: BrowserPreset {
    BrowserPreset.resolve(runtime.browserPreset, custom: customPresets)
  }

  private var claimId: String { "browser:\(sessionKey)" }

  private var otherHolder: RemoteDeviceClaim? {
    guard let holder = store.deviceClaims[claimId]?.holder, let mine = store.connectionId
    else { return nil }
    return holder.connectionId == mine ? nil : holder
  }

  var body: some View {
    VStack(spacing: 0) {
      navBar
      Divider()
      stage
    }
    .task(id: OpenKey(session: sessionKey, ready: store.connection == .ready)) {
      guard store.connection == .ready else { return }
      await open()
    }
    .onDisappear { close() }
  }

  // MARK: Chrome

  private var navBar: some View {
    HStack(spacing: 4) {
      navButton("Back", Icon.chevronLeft, enabled: canGoBack) {
        command(ArgusProtocol.Commands.BrowserViewBack.self, .init(sessionId: sessionKey), .back)
      }
      navButton("Forward", Icon.chevronRight, enabled: canGoForward) {
        command(
          ArgusProtocol.Commands.BrowserViewForward.self, .init(sessionId: sessionKey), .forward)
      }
      TextField("Enter URL…", text: $inputUrl)
        .textFieldStyle(.roundedBorder)
        .controlSize(.small)
        .onSubmit(submitUrl)
        .accessibilityLabel("Address")
      navButton("Reload", Icon.refresh, enabled: !inputUrl.isEmpty) {
        command(
          ArgusProtocol.Commands.BrowserViewReload.self, .init(sessionId: sessionKey), .reload)
      }
      Picker("Viewport", selection: presetBinding) {
        ForEach(BrowserPreset.builtIn) { Text($0.label).tag($0.id) }
        if !customPresets.isEmpty {
          Divider()
          ForEach(customPresets) { Text($0.label).tag($0.id) }
        }
      }
      .labelsHidden()
      .controlSize(.small)
      .fixedSize()
    }
    .padding(.horizontal, 8)
    .frame(height: 32)
  }

  private func navButton(
    _ label: String, _ icon: String, enabled: Bool, run: @escaping () -> Void
  ) -> some View {
    Button(action: run) { Image(systemName: icon).frame(width: 20, height: 20) }
      .buttonStyle(.borderless)
      .disabled(!enabled)
      .help(label)
      .accessibilityLabel(label)
  }

  private var presetBinding: Binding<String> {
    Binding(
      get: { preset.id },
      set: { id in
        runtime.browserPreset = id
        let next = BrowserPreset.resolve(id, custom: customPresets)
        command(
          ArgusProtocol.Commands.BrowserUpdatePreset.self,
          .init(sessionId: sessionKey, preset: next.wire), .preset)
      })
  }

  private var stage: some View {
    GeometryReader { proxy in
      ZStack {
        theme.mediaBg
        RuntimeJpegView(handle: frame) { receiving = true }
        RuntimeInputView(onInput: receive)
        if !receiving {
          Text("Waiting for frames…")
            .font(.system(size: 12))
            .foregroundStyle(theme.textMuted)
            .allowsHitTesting(false)
        }
        if let holder = otherHolder {
          RuntimeClaimOverlay(holderLabel: holder.label) {
            Task { await store.claimDevice(deviceId: claimId, force: true) }
          }
        }
      }
      .onAppear { stageSize = proxy.size }
      .onChange(of: proxy.size) { _, size in stageSize = size }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Browser page")
  }

  // MARK: Input

  /// A stage point to viewport pixels of the letterboxed page.
  private func viewport(_ point: CGPoint) -> CGPoint {
    let natural = frame.imageSize == .zero
      ? CGSize(width: preset.width, height: preset.height) : frame.imageSize
    let geometry = DeviceGeometry(coded: natural, stage: stageSize)
    let normalized = geometry.normalize(point) ?? .zero
    return CGPoint(x: normalized.x * natural.width, y: normalized.y * natural.height)
  }

  private func receive(_ input: RuntimeInput) {
    guard otherHolder == nil, let backend = store.backend else { return }
    let sessionId = sessionKey
    switch input {
    case .pointer(let phase, let point, let secondary, _):
      let at = viewport(point)
      let type: ArgusProtocol.CommandsTypes.BrowserMouseEventParamsType =
        switch phase {
        case .down: .down
        case .move: .move
        case .up: .up
        }
      Task {
        _ = try? await backend.request(
          ArgusProtocol.Commands.BrowserMouseEvent.self,
          .init(
            sessionId: sessionId, type: type, x: at.x, y: at.y,
            button: phase == .move ? nil : (secondary ? .right : .left)))
      }
    case .wheel(let point, let deltaX, let deltaY):
      let at = viewport(point)
      Task {
        _ = try? await backend.request(
          ArgusProtocol.Commands.BrowserWheelEvent.self,
          .init(sessionId: sessionId, x: at.x, y: at.y, deltaX: deltaX, deltaY: deltaY))
      }
    case .hover:
      break
    case .key(let down, let keyCode, _, let characters):
      guard let key = KeyMap.domKey(macKeyCode: keyCode, characters: characters) else { return }
      Task {
        _ = try? await backend.request(
          ArgusProtocol.Commands.BrowserKeyboardEvent.self,
          .init(sessionId: sessionId, type: down ? .down : .up, key: key))
      }
    }
  }

  // MARK: Lifecycle

  /// Reserve the session's browser, load its start URL once, and stream it.
  private func open() async {
    close()
    receiving = false
    canGoBack = false
    canGoForward = false
    stopNav = store.observeIpc { channel, args, _ in
      guard channel == "browser_view:nav", let nav = args.first?.objectValue,
        nav["sessionId"]?.stringValue == sessionKey
      else { return }
      if let url = nav["url"]?.stringValue, !url.isEmpty {
        inputUrl = url
        runtime.browserUrls[sessionKey] = url
      }
      canGoBack = nav["canGoBack"] == .bool(true)
      canGoForward = nav["canGoForward"] == .bool(true)
    }

    let url = runtime.browserUrls[sessionKey]
      ?? BrowserPreset.normalize(runtime.projectConfig?.browserUrl ?? Self.fallbackUrl)
    inputUrl = url
    runtime.browserUrls[sessionKey] = url
    let firstVisit = !runtime.openedBrowsers.contains(sessionKey)
    runtime.openedBrowsers.insert(sessionKey)

    if let backend = store.backend {
      _ = try? await backend.request(
        ArgusProtocol.Commands.BrowserViewEnsure.self, .init(sessionId: sessionKey))
      if firstVisit {
        _ = try? await backend.request(
          ArgusProtocol.Commands.BrowserViewNavigate.self, .init(sessionId: sessionKey, url: url))
      }
    }
    guard !Task.isCancelled else { return }
    let frame = frame
    detach = await runtime.streams.attach(.browser(sessionKey)) { message in
      if case .jpeg(_, _, let data) = message { frame.show(data) }
    }
  }

  private func close() {
    detach?()
    detach = nil
    stopNav?()
    stopNav = nil
  }

  private func submitUrl() {
    let url = BrowserPreset.normalize(inputUrl)
    guard !url.isEmpty else { return }
    inputUrl = url
    runtime.browserUrls[sessionKey] = url
    let sessionId = sessionKey
    Task {
      guard let backend = store.backend else { return }
      _ = try? await backend.request(
        ArgusProtocol.Commands.BrowserViewEnsure.self, .init(sessionId: sessionId))
      _ = try? await backend.request(
        ArgusProtocol.Commands.BrowserViewNavigate.self, .init(sessionId: sessionId, url: url))
    }
    MacTelemetry.capture(.browserUsed(action: .navigate))
  }

  private func command<C: RemoteCommand>(
    _ command: C.Type, _ params: C.Params, _ action: MacTelemetryEvent.BrowserAction
  ) {
    let backend = store.backend
    Task { _ = try? await backend?.request(C.self, params) }
    MacTelemetry.capture(.browserUsed(action: action))
  }
}

/// Reopen when the session changes or the host (re)connects.
private struct OpenKey: Hashable {
  var session: String
  var ready: Bool
}

/// A JPEG stream drawn into a layer, scaled to fit. SwiftUI's `Image` would
/// rebuild its view for every frame.
struct RuntimeJpegView: NSViewRepresentable {
  @MainActor
  final class Handle {
    fileprivate weak var view: NSView?
    fileprivate var onFirstFrame: (() -> Void)?
    /// The last frame's pixel size, for mapping pointer positions.
    private(set) var imageSize = CGSize.zero

    func show(_ data: Data) {
      guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
      else { return }
      imageSize = CGSize(width: image.width, height: image.height)
      view?.layer?.contents = image
      onFirstFrame?()
      onFirstFrame = nil
    }
  }

  let handle: Handle
  let onFirstFrame: () -> Void

  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    view.wantsLayer = true
    view.layer?.contentsGravity = .resizeAspect
    handle.view = view
    handle.onFirstFrame = onFirstFrame
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {}
}
