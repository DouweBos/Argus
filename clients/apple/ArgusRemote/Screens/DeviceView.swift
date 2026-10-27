import ArgusUI
import SwiftUI

/// A live mirrored device: H.264 in, touches and keystrokes back out.
struct DeviceView: View {
  private enum Status { case connecting, error, noVideo, streaming }

  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

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
  @State private var busy = false
  /// When this screen started watching, and whether anything was driven from
  /// it — a glance and a working session are worth telling apart.
  @State private var watchStart: Date?
  @State private var interacted = false
  @State private var confirmingEnd = false

  /// An EAS Simulator session: a billed cloud device that can't rotate.
  private var isEas: Bool { deviceId.hasPrefix("eas:") }

  /// Booted but producing nothing decodable — worth saying so rather than
  /// spinning forever.
  private static let noVideoTimeout = Duration.seconds(10)
  /// Minimum finger travel, in points, between injected drag samples.
  private static let dragMinTravel: CGFloat = 2

  /// The host's own reading, preferred over the reply we last got: the hinge
  /// and orientation move from Device Hub or an agent as easily as from here.
  private var deviceState: RemoteDeviceState? { host.deviceStates[deviceId] }

  /// Clockwise degrees the stream has to be turned to sit upright. The
  /// framebuffer is panel-native, so a rotated device arrives sideways.
  private var rotation: Double { Double(deviceState?.display?.rotation ?? 0) }

  private var geometry: DeviceGeometry {
    DeviceGeometry(coded: codedSize, stage: stageSize, rotation: rotation)
  }

  var body: some View {
    VStack(spacing: 0) {
      stage
      if !host.hasControl {
        Banner(
          text:
            "This device can watch but not control. Grant it control in Argus → Settings → Remote Access to tap and type here."
        )
        .padding(theme.space)
      } else if let holder = otherHolder {
        // Input would be refused outright, so say who has it and offer to take
        // it rather than letting taps vanish.
        VStack(alignment: .leading, spacing: 8) {
          Banner(text: "\(holder.label) is controlling this device.", tone: .warning)
          Btn(label: "Take control", tone: .secondary, small: true) {
            Task { await host.claimDevice(deviceId: deviceId, force: true) }
          }
        }
        .padding(theme.space)
      } else if isTv {
        TVRemoteView(press: sendButton, isAndroid: platform == .android)
          .background(theme.bgSecondary)
          .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
        HardwareKeyCatcher(press: sendButton).frame(width: 0, height: 0)
      } else {
        buttonBar
        keyboardCapture
      }
    }
    .background(theme.bg)
    .navigationTitle(name)
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog("End this EAS Simulator session?", isPresented: $confirmingEnd, titleVisibility: .visible) {
      Button("End session", role: .destructive, action: endSession)
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("The cloud device goes away and stops billing.")
    }
    .task(id: host.connection) { await subscribe() }
    .onDisappear { teardown() }
  }

  private var stage: some View {
    GeometryReader { geometry in
      ZStack {
        theme.mediaBg
        video
        if status != .streaming {
          Text(placeholder)
            .font(.system(size: 13))
            .foregroundStyle(theme.textMuted)
            .multilineTextAlignment(.center)
            .padding(theme.space)
        }
      }
      .contentShape(Rectangle())
      // A TV is driven by the remote below, not by tapping its picture —
      // a tap there is nothing, not a click of the dpad's centre.
      .gesture(host.hasControl && !isTv ? touchGesture : nil)
      .onAppear { stageSize = geometry.size }
      .onChange(of: geometry.size) { _, size in stageSize = size }
    }
  }

  /// Sized in the stream's own axes and then turned, so a landscape device
  /// fills the width instead of being letterboxed into a portrait box.
  private var video: some View {
    let rendered = geometry.renderedSize
    return DeviceVideoView(handle: handle) { status = .streaming }
      .frame(width: rendered.width, height: rendered.height)
      .rotationEffect(.degrees(rotation))
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
        lastDragPoint = nil
        send(value.location, phase: 2)
      }
  }

  private func send(_ point: CGPoint, phase: Int) {
    guard let normalized = geometry.normalize(point) else { return }
    interacted = true
    host.deviceTouch(
      deviceId: deviceId, platform: platform,
      x: normalized.x, y: normalized.y, eventType: phase)
  }

  private func sendButton(_ button: String) {
    interacted = true
    host.deviceButton(deviceId: deviceId, platform: platform, button: button)
  }

  private var buttons: [(id: String, label: String, icon: String)] {
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
        IconBtn(systemName: button.icon, label: button.label) { sendButton(button.id) }
      }
      IconBtn(systemName: Icon.keyboard, label: "Keyboard") { keyboardFocused = true }
      if isEas {
        // Ending the session ends the device and its billing.
        IconBtn(systemName: Icon.stop, label: "End session") { confirmingEnd = true }
          .disabled(busy)
      } else if platform == .ios {
        IconBtn(systemName: Icon.rotate, label: "Rotate") { rotate() }
          .disabled(busy)
      }
      if let fold = deviceState?.fold {
        IconBtn(
          systemName: Icon.fold,
          label: fold.pose == .open ? "Fold device" : "Unfold device"
        ) { toggleFold(fold) }
        .disabled(busy)
      }
      Spacer()
    }
    .padding(.vertical, 8)
    .background(theme.bgSecondary)
    .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
  }

  private func endSession() {
    busy = true
    Task {
      defer { busy = false }
      try? await host.stopEasSession(deviceId: deviceId)
    }
  }

  private func rotate() {
    let next = (deviceState?.orientation ?? .portrait).next
    busy = true
    Task {
      await host.setDeviceOrientation(
        deviceId: deviceId, platform: platform, orientation: next)
      busy = false
    }
  }

  private func toggleFold(_ fold: RemoteFoldState) {
    busy = true
    Task {
      await host.setDeviceFold(
        deviceId: deviceId, platform: platform,
        pose: fold.pose == .open ? .closed : .open)
      busy = false
    }
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
    interacted = true
    host.deviceKeyboard(
      deviceId: deviceId, platform: platform, keyCode: key.keyCode,
      modifiers: key.modifiers, isDown: true)
    host.deviceKeyboard(
      deviceId: deviceId, platform: platform, keyCode: key.keyCode,
      modifiers: key.modifiers, isDown: false)
  }

  // MARK: Stream

  private func subscribe() async {
    guard host.connection == .ready else { return }
    status = .connecting
    if watchStart == nil { watchStart = Date() }

    guard let streamId = await host.watchDevice(deviceId: deviceId, platform: platform) else {
      status = .error
      return
    }
    unregister = host.registerMediaSink(streamId: streamId) { message in
      switch message {
      case .config(_, let codec, let width, let height, let description):
        codedSize = CGSize(width: width, height: height)
        handle.configure(
          codec: codec, width: width, height: height, description: description)
      case .frame(_, let keyFrame, let timestamp, let data):
        handle.enqueue(data, isKeyFrame: keyFrame, timestampMillis: timestamp)
      case .jpeg:
        break
      }
    }

    // Take the device unless someone else is already driving it; the host
    // pushes `device.claim` from here on.
    if host.hasControl {
      await host.loadClaimStatus(deviceId: deviceId)
      if otherHolder == nil {
        await host.claimDevice(deviceId: deviceId)
      }
    }

    // Seed the pose; the host pushes `device.state` from here on while it is
    // being watched.
    await host.deviceState(deviceId: deviceId, platform: platform)

    Task {
      try? await Task.sleep(for: Self.noVideoTimeout)
      if status == .connecting { status = .noVideo }
    }
  }

  /// The claim, when someone other than this phone holds it.
  private var otherHolder: RemoteDeviceClaim? {
    guard let holder = host.deviceClaims[deviceId]?.holder else { return nil }

    return holder.connectionId == host.connectionId ? nil : holder
  }

  private func teardown() {
    if let watchStart {
      Telemetry.capture(
        .deviceWatched(
          durationMs: Int(Date().timeIntervalSince(watchStart) * 1000), interacted: interacted))
    }
    unregister?()
    unregister = nil
    Task {
      // Let go before leaving, so the next client isn't locked out by a screen
      // nobody is looking at.
      await host.releaseDevice(deviceId: deviceId)
      await host.unwatchDevice(deviceId: deviceId)
    }
  }
}
