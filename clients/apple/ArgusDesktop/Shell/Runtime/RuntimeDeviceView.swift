import ArgusUI
import SwiftUI

/// A live simulator or emulator: H.264 in through `AVSampleBufferDisplayLayer`,
/// mouse and keyboard back out as touches and key presses. The renderer's
/// `IosDeviceStreamView` / `AndroidDeviceStreamView` with `CanvasStreamBody`.
struct RuntimeDeviceView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime

  let deviceId: String
  let platform: RemotePlatform
  let isTv: Bool

  @State private var handle = DeviceVideoView.Handle()
  @State private var session = DeviceSession { watch in
    MacTelemetry.capture(
      .deviceWatched(
        platform: watch.platform.rawValue, durationMs: watch.durationMs,
        interacted: watch.interacted))
  }
  @State private var stageSize = CGSize.zero
  @State private var width: CGFloat = 0

  private static let remoteBesideMinWidth: CGFloat = 640

  private var deviceState: RemoteDeviceState? { store.deviceStates[deviceId] }
  private var rotation: Double { Double(deviceState?.display?.rotation ?? 0) }

  private var geometry: DeviceGeometry {
    DeviceGeometry(coded: session.codedSize, stage: stageSize, rotation: rotation)
  }

  /// Someone other than this Mac holds the device; input would be refused.
  private var otherHolder: RemoteDeviceClaim? {
    DeviceSession.otherHolder(store.deviceClaims[deviceId], connectionId: store.connectionId)
  }

  var body: some View {
    // A TV picture is landscape: in a narrow column the remote goes under it
    // rather than beside it, or the picture shrinks to a sliver.
    let remoteBeside = width >= Self.remoteBesideMinWidth
    (remoteBeside ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))) {
      stage
      if isTv {
        TVRemoteView(press: sendButton, isAndroid: platform == .android)
          .frame(width: remoteBeside ? 240 : nil)
          .frame(maxWidth: remoteBeside ? nil : .infinity)
          .background(theme.bgSecondary)
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    .task(id: SubscribeKey(device: deviceId, host: runtime.hostId, ready: store.connection == .ready)) {
      guard store.connection == .ready else { return }
      await subscribe()
    }
    .onDisappear { session.stop() }
  }

  private var stage: some View {
    GeometryReader { proxy in
      ZStack {
        // The panel's canvas around the picture, so a letterboxed device doesn't sit in a black slab.
        theme.bg
        DeviceVideoView(handle: handle) { session.markStreaming() }
          .frame(width: geometry.renderedSize.width, height: geometry.renderedSize.height)
          .rotationEffect(.degrees(rotation))
        RuntimeInputView(onInput: receive)
        if session.status != .streaming {
          Text(placeholder)
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
            .multilineTextAlignment(.center)
            .padding(theme.space)
            .allowsHitTesting(false)
        }
        if let holder = otherHolder {
          RuntimeClaimOverlay(holderLabel: holder.label) {
            Task { await store.claimDevice(deviceId: deviceId, force: true) }
          }
        }
      }
      .onAppear { stageSize = proxy.size }
      .onChange(of: proxy.size) { _, size in stageSize = size }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Device screen")
  }

  private var placeholder: String {
    switch session.status {
    case .connecting: session.codedSize == .zero ? "Connecting to device…" : "Decoding first frame…"
    case .error: "Couldn't start the stream. Is the device still booted?"
    case .noVideo: "No video from this device — it's booted but not producing a stream."
    case .streaming: ""
    }
  }

  // MARK: Input

  private func receive(_ input: RuntimeInput) {
    guard otherHolder == nil else { return }
    switch input {
    case .pointer(let phase, let point, let secondary, _):
      // A TV is driven by its remote, not by clicking its picture.
      guard !secondary, !isTv, let normalized = geometry.normalize(point) else { return }
      session.markInteracted()
      store.deviceTouch(
        deviceId: deviceId, platform: platform, x: normalized.x, y: normalized.y,
        eventType: phase.rawValue)
    case .wheel, .hover:
      break
    case .key(let down, let keyCode, let modifiers, _):
      sendKey(down: down, keyCode: keyCode, modifiers: modifiers)
    }
  }

  private func sendKey(down: Bool, keyCode: Int, modifiers: Int) {
    if isTv {
      if down, let button = Self.tvButtons[keyCode] { sendButton(button) }
      return
    }
    // ⌘-combos stay the Mac's, except ⌘⇧H (Home) and ⌘ itself, as on the desktop.
    let command = modifiers & KeyMap.MacModifier.command != 0
    let commandShiftH =
      command && modifiers & KeyMap.MacModifier.shift != 0 && keyCode == 4
    if command, keyCode != 54, keyCode != 55, !commandShiftH { return }
    guard
      let key = KeyMap.nativeKey(platform: platform, macKeyCode: keyCode, modifierFlags: modifiers)
    else { return }
    session.markInteracted()
    store.deviceKeyboard(
      deviceId: deviceId, platform: platform, keyCode: key.keyCode, modifiers: key.modifiers,
      isDown: down)
  }

  /// Arrows, Return and Escape drive a TV's d-pad, as on the phone.
  private static let tvButtons: [Int: String] = [
    126: "up", 125: "down", 123: "left", 124: "right", 36: "select", 53: "menu",
  ]

  private func sendButton(_ button: String) {
    session.markInteracted()
    store.deviceButton(deviceId: deviceId, platform: platform, button: button)
  }

  // MARK: Stream

  private func subscribe() async {
    await session.run(
      deviceId: deviceId, platform: platform, host: store, claim: true,
      attach: { [runtime, deviceId, platform] sink in
        await runtime.streams.attach(.device(deviceId, platform), sink)
      },
      sink: handle.receive)
  }
}

/// Resubscribe when the device changes or the host (re)connects.
private struct SubscribeKey: Hashable {
  var device: String
  /// A device two hosts list streams from the one the panel shows.
  var host: String
  var ready: Bool
}

/// Someone else is driving: say who, and offer to take it. Taps are blocked,
/// but the picture stays in plain view so a demo can still be watched.
struct RuntimeClaimOverlay: View {
  @Environment(\.theme) private var theme
  let holderLabel: String
  let takeControl: () -> Void

  var body: some View {
    Color.clear
      .contentShape(.rect)
      .overlay(alignment: .bottom) {
        HStack(spacing: 8) {
          Image(systemName: "lock.fill").font(.scaled(size: 10)).foregroundStyle(theme.warning)
          Text("\(holderLabel) is controlling this device")
            .font(.scaled(size: 12, weight: .medium))
            .foregroundStyle(theme.text)
            .lineLimit(1)
          Button("Take Control", action: takeControl)
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 6)
        .background(theme.bgSecondary, in: .capsule)
        .overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }
        .padding(12)
      }
  }
}
