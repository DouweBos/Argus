import ArgusKit
import SwiftUI

/// A live mirrored device: H.264 in, touches and keystrokes back out.
struct DeviceView: View {
  private enum Status { case connecting, error, noVideo, streaming }

  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let deviceId: String
  let platform: RemotePlatform
  let name: String
  let isTv: Bool

  @State private var handle = DeviceVideoView.Handle()
  @State private var status = Status.connecting
  @State private var codedSize = CGSize.zero
  @State private var stageSize = CGSize.zero
  @State private var keyboardText = ""
  @State private var keyboardFocused = false
  @FocusState private var keyboardField: Bool
  @State private var unregister: (() -> Void)?
  @State private var lastDragPoint: CGPoint?
  @State private var tvDragStart: CGPoint?

  /// Booted but producing nothing decodable — worth saying so rather than
  /// spinning forever.
  private static let noVideoTimeout = Duration.seconds(10)
  /// Minimum finger travel, in points, between injected drag samples.
  private static let dragMinTravel: CGFloat = 2
  /// A drag shorter than this counts as a tap, which on a TV is Select.
  private static let tvSwipeThreshold: CGFloat = 24

  var body: some View {
    VStack(spacing: 0) {
      stage
      if !app.hasControl {
        Banner(
          text:
            "This device can watch but not control. Grant it control in Argus → Settings → Remote Access to tap and type here."
        )
        .padding(theme.space)
      } else {
        buttonBar
      }
      keyboardCapture
    }
    .background(theme.bg)
    .navigationTitle(name)
    .navigationBarTitleDisplayMode(.inline)
    .task(id: app.connection) { await subscribe() }
    .onDisappear { teardown() }
  }

  private var stage: some View {
    GeometryReader { geometry in
      ZStack {
        theme.mediaBg
        DeviceVideoView(handle: handle) { status = .streaming }
        if status != .streaming {
          Text(placeholder)
            .font(.system(size: 13))
            .foregroundStyle(theme.textMuted)
            .multilineTextAlignment(.center)
            .padding(theme.space)
        }
      }
      .contentShape(Rectangle())
      .gesture(app.hasControl ? touchGesture : nil)
      .onAppear { stageSize = geometry.size }
      .onChange(of: geometry.size) { _, size in stageSize = size }
    }
  }

  private var placeholder: String {
    switch status {
    case .connecting: "Connecting to device…"
    case .error: "Couldn't start the stream. Is the device still booted?"
    case .noVideo: "No video from this device — it's booted but not producing a stream."
    case .streaming: ""
    }
  }

  // MARK: Input

  private var touchGesture: some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { value in
        if isTv {
          if tvDragStart == nil { tvDragStart = value.startLocation }
          return
        }
        if lastDragPoint == nil {
          lastDragPoint = value.location
          send(value.location, phase: 0)
          return
        }
        // Throttle by distance travelled rather than by a clock: it tracks
        // what the far end actually needs to redraw.
        guard let last = lastDragPoint else { return }
        let travel = hypot(value.location.x - last.x, value.location.y - last.y)
        guard travel >= Self.dragMinTravel else { return }
        lastDragPoint = value.location
        send(value.location, phase: 1)
      }
      .onEnded { value in
        if isTv {
          sendTvDirection(from: tvDragStart ?? value.startLocation, to: value.location)
          tvDragStart = nil
          return
        }
        lastDragPoint = nil
        send(value.location, phase: 2)
      }
  }

  /// Normalise to 0–1 within the letterboxed video, not the stage — the video
  /// rarely fills the whole view and a naive mapping drifts.
  private func normalize(_ point: CGPoint) -> CGPoint? {
    guard codedSize.width > 0, codedSize.height > 0,
      stageSize.width > 0, stageSize.height > 0
    else { return nil }
    let scale = min(stageSize.width / codedSize.width, stageSize.height / codedSize.height)
    let rendered = CGSize(
      width: codedSize.width * scale, height: codedSize.height * scale)
    let origin = CGPoint(
      x: (stageSize.width - rendered.width) / 2,
      y: (stageSize.height - rendered.height) / 2)
    return CGPoint(
      x: min(max(0, (point.x - origin.x) / rendered.width), 0.9999),
      y: min(max(0, (point.y - origin.y) / rendered.height), 0.9999))
  }

  private func send(_ point: CGPoint, phase: Int) {
    guard let normalized = normalize(point) else { return }
    app.deviceTouch(
      deviceId: deviceId, platform: platform,
      x: normalized.x, y: normalized.y, eventType: phase)
  }

  /// A TV has no touchscreen: a tap is Select and a drag is a d-pad direction.
  private func sendTvDirection(from start: CGPoint, to end: CGPoint) {
    let dx = end.x - start.x
    let dy = end.y - start.y
    let button: String
    if abs(dx) < Self.tvSwipeThreshold && abs(dy) < Self.tvSwipeThreshold {
      button = "select"
    } else if abs(dx) > abs(dy) {
      button = dx > 0 ? "right" : "left"
    } else {
      button = dy > 0 ? "down" : "up"
    }
    app.deviceButton(deviceId: deviceId, platform: platform, button: button)
  }

  private var buttons: [(id: String, label: String, icon: String)] {
    if isTv {
      return [
        (platform == .ios ? "menu" : "back", platform == .ios ? "Menu" : "Back", Icon.arrowBack),
        ("home", "Home", Icon.home),
      ]
    }
    if platform == .ios {
      return [("ios_home", "Home", Icon.home)]
    }
    return [
      ("back", "Back", Icon.androidBack),
      ("home", "Home", Icon.home),
      ("recents", "Recents", Icon.androidRecents),
    ]
  }

  private var buttonBar: some View {
    HStack(spacing: 4) {
      Spacer()
      ForEach(buttons, id: \.id) { button in
        IconBtn(systemName: button.icon, label: button.label) {
          app.deviceButton(deviceId: deviceId, platform: platform, button: button.id)
        }
      }
      if !isTv {
        IconBtn(systemName: Icon.keyboard, label: "Keyboard") {
          keyboardFocused = true
        }
      }
      Spacer()
    }
    .padding(.vertical, 8)
    .background(theme.bgSecondary)
    .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
  }

  /// An off-screen field that forwards each character as a key event and keeps
  /// nothing locally — the device holds the real text.
  private var keyboardCapture: some View {
    TextField("", text: $keyboardText)
      .focused($keyboardField)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .frame(height: 0)
      .opacity(0.01)
      .onChange(of: keyboardText) { _, text in
        for character in text { sendKey(String(character)) }
        keyboardText = ""
      }
      .onSubmit { sendKey("Enter") }
      .onChange(of: keyboardFocused) { _, focused in keyboardField = focused }
      .onChange(of: keyboardField) { _, focused in keyboardFocused = focused }
  }

  private func sendKey(_ character: String) {
    guard let key = KeyMap.nativeKey(platform: platform, character: character) else { return }
    app.deviceKeyboard(
      deviceId: deviceId, platform: platform, keyCode: key.keyCode,
      modifiers: key.modifiers, isDown: true)
    app.deviceKeyboard(
      deviceId: deviceId, platform: platform, keyCode: key.keyCode,
      modifiers: key.modifiers, isDown: false)
  }

  // MARK: Stream

  private func subscribe() async {
    guard app.connection == .ready else { return }
    status = .connecting

    guard let streamId = await app.watchDevice(deviceId: deviceId, platform: platform) else {
      status = .error
      return
    }
    unregister = app.registerMediaSink(streamId: streamId) { message in
      switch message {
      case .config(_, let codec, let width, let height, let description):
        codedSize = CGSize(width: width, height: height)
        handle.configure(
          codec: codec, width: width, height: height, description: description)
      case .frame(_, let keyFrame, let timestamp, let data):
        handle.enqueue(data, isKeyFrame: keyFrame, timestampMillis: timestamp)
      }
    }

    Task {
      try? await Task.sleep(for: Self.noVideoTimeout)
      if status == .connecting { status = .noVideo }
    }
  }

  private func teardown() {
    unregister?()
    unregister = nil
    Task { await app.unwatchDevice(deviceId: deviceId) }
  }
}
