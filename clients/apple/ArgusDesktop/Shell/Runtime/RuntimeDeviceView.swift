import ArgusUI
import SwiftUI

/// A live simulator or emulator: H.264 in through `AVSampleBufferDisplayLayer`,
/// mouse and keyboard back out as touches and key presses. The renderer's
/// `IosDeviceStreamView` / `AndroidDeviceStreamView` with `CanvasStreamBody`.
struct RuntimeDeviceView: View {
  private enum Status { case connecting, error, noVideo, streaming }

  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime

  let deviceId: String
  let platform: RemotePlatform
  let isTv: Bool

  @State private var handle = DeviceVideoView.Handle()
  @State private var status = Status.connecting
  @State private var codedSize = CGSize.zero
  @State private var stageSize = CGSize.zero
  @State private var detach: (() -> Void)?
  @State private var watchStart: Date?
  @State private var interacted = false

  private static let noVideoTimeout = Duration.seconds(10)

  private var deviceState: RemoteDeviceState? { store.deviceStates[deviceId] }
  private var rotation: Double { Double(deviceState?.display?.rotation ?? 0) }

  private var geometry: DeviceGeometry {
    DeviceGeometry(coded: codedSize, stage: stageSize, rotation: rotation)
  }

  /// Someone other than this Mac holds the device; input would be refused.
  private var otherHolder: RemoteDeviceClaim? {
    guard let holder = store.deviceClaims[deviceId]?.holder,
      let mine = store.connectionId
    else { return nil }
    return holder.connectionId == mine ? nil : holder
  }

  var body: some View {
    HStack(spacing: 0) {
      stage
      if isTv {
        TVRemoteView(press: sendButton, isAndroid: platform == .android)
          .frame(width: 240)
          .background(theme.bgSecondary)
      }
    }
    .task(id: SubscribeKey(device: deviceId, ready: store.connection == .ready)) {
      guard store.connection == .ready else { return }
      await subscribe()
    }
    .onDisappear { teardown() }
  }

  private var stage: some View {
    GeometryReader { proxy in
      ZStack {
        theme.mediaBg
        DeviceVideoView(handle: handle) { status = .streaming }
          .frame(width: geometry.renderedSize.width, height: geometry.renderedSize.height)
          .rotationEffect(.degrees(rotation))
        RuntimeInputView(onInput: receive)
        if status != .streaming {
          Text(placeholder)
            .font(.system(size: 12))
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
    switch status {
    case .connecting: codedSize == .zero ? "Connecting to device…" : "Decoding first frame…"
    case .error: "Couldn't start the stream. Is the device still booted?"
    case .noVideo: "No video from this device — it's booted but not producing a stream."
    case .streaming: ""
    }
  }

  // MARK: Input

  private func receive(_ input: RuntimeInput) {
    guard otherHolder == nil else { return }
    switch input {
    case .pointer(let phase, let point, let secondary):
      // A TV is driven by its remote, not by clicking its picture.
      guard !secondary, !isTv, let normalized = geometry.normalize(point) else { return }
      interacted = true
      store.deviceTouch(
        deviceId: deviceId, platform: platform, x: normalized.x, y: normalized.y,
        eventType: phase.rawValue)
    case .wheel:
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
    interacted = true
    store.deviceKeyboard(
      deviceId: deviceId, platform: platform, keyCode: key.keyCode, modifiers: key.modifiers,
      isDown: down)
  }

  /// Arrows, Return and Escape drive a TV's d-pad, as on the phone.
  private static let tvButtons: [Int: String] = [
    126: "up", 125: "down", 123: "left", 124: "right", 36: "select", 53: "menu",
  ]

  private func sendButton(_ button: String) {
    interacted = true
    store.deviceButton(deviceId: deviceId, platform: platform, button: button)
  }

  // MARK: Stream

  private func subscribe() async {
    teardown()
    status = .connecting
    codedSize = .zero
    watchStart = Date()
    interacted = false

    let handle = handle
    guard
      let stop = await runtime.streams.attach(
        .device(deviceId, platform),
        { message in
          switch message {
          case .config(_, let codec, let width, let height, let description):
            codedSize = CGSize(width: width, height: height)
            handle.configure(codec: codec, width: width, height: height, description: description)
          case .frame(_, let keyFrame, let timestamp, let data):
            handle.enqueue(data, isKeyFrame: keyFrame, timestampMillis: timestamp)
          case .jpeg:
            break
          }
        })
    else {
      status = .error
      return
    }
    detach = stop

    // Take the device unless someone else is already driving it; the host
    // pushes `device.claim` from here on.
    await store.loadClaimStatus(deviceId: deviceId)
    if otherHolder == nil { await store.claimDevice(deviceId: deviceId) }
    await store.deviceState(deviceId: deviceId, platform: platform)

    try? await Task.sleep(for: Self.noVideoTimeout)
    if !Task.isCancelled, status == .connecting { status = .noVideo }
  }

  private func teardown() {
    if let watchStart {
      MacTelemetry.capture(
        .deviceWatched(
          platform: platform.rawValue,
          durationMs: Int(Date().timeIntervalSince(watchStart) * 1000), interacted: interacted))
    }
    watchStart = nil
    detach?()
    detach = nil
  }
}

/// Resubscribe when the device changes or the host (re)connects.
private struct SubscribeKey: Hashable {
  var device: String
  var ready: Bool
}

/// Someone else is driving: say who, and offer to take it.
struct RuntimeClaimOverlay: View {
  @Environment(\.theme) private var theme
  let holderLabel: String
  let takeControl: () -> Void

  var body: some View {
    ZStack {
      theme.mediaBg.opacity(0.6)
      VStack(spacing: 10) {
        Text("\(holderLabel) is controlling this device")
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(theme.text)
        Button("Take Control", action: takeControl)
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
      }
      .padding(16)
      .background(theme.bgSecondary, in: .rect(cornerRadius: theme.radiusSmall))
    }
  }
}
