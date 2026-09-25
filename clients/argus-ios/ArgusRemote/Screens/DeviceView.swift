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
  @State private var busy = false
  /// When this screen started watching, and whether anything was driven from
  /// it — a glance and a working session are worth telling apart.
  @State private var watchStart: Date?
  @State private var interacted = false

  /// Booted but producing nothing decodable — worth saying so rather than
  /// spinning forever.
  private static let noVideoTimeout = Duration.seconds(10)
  /// Minimum finger travel, in points, between injected drag samples.
  private static let dragMinTravel: CGFloat = 2

  /// The host's own reading, preferred over the reply we last got: the hinge
  /// and orientation move from Device Hub or an agent as easily as from here.
  private var deviceState: RemoteDeviceState? { app.deviceStates[deviceId] }

  /// Clockwise degrees the stream has to be turned to sit upright. The
  /// framebuffer is panel-native, so a rotated device arrives sideways.
  private var rotation: Double { Double(deviceState?.display?.rotation ?? 0) }

  private var quarterTurn: Bool { rotation == 90 || rotation == 270 }

  var body: some View {
    VStack(spacing: 0) {
      stage
      if !app.hasControl {
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
            Task { await app.claimDevice(deviceId: deviceId, force: true) }
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
    .task(id: app.connection) { await subscribe() }
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
      .gesture(app.hasControl && !isTv ? touchGesture : nil)
      .onAppear { stageSize = geometry.size }
      .onChange(of: geometry.size) { _, size in stageSize = size }
    }
  }

  /// Sized in the stream's own axes and then turned, so a landscape device
  /// fills the width instead of being letterboxed into a portrait box.
  private var video: some View {
    let rendered = renderedVideoSize
    return DeviceVideoView(handle: handle) { status = .streaming }
      .frame(width: rendered.width, height: rendered.height)
      .rotationEffect(.degrees(rotation))
  }

  /// The video's size before rotation. Zero until the first config lands,
  /// which is fine — there is nothing to show yet.
  private var renderedVideoSize: CGSize {
    guard codedSize.width > 0, codedSize.height > 0,
      stageSize.width > 0, stageSize.height > 0
    else { return stageSize }
    let shown = shownSize
    let scale = min(stageSize.width / shown.width, stageSize.height / shown.height)
    return CGSize(width: codedSize.width * scale, height: codedSize.height * scale)
  }

  /// The stream's footprint on screen, with its axes swapped on a quarter turn.
  private var shownSize: CGSize {
    quarterTurn
      ? CGSize(width: codedSize.height, height: codedSize.width)
      : codedSize
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

  /// Normalise to 0–1 within the letterboxed video, not the stage — the video
  /// rarely fills the whole view and a naive mapping drifts.
  private func normalize(_ point: CGPoint) -> CGPoint? {
    guard codedSize.width > 0, codedSize.height > 0,
      stageSize.width > 0, stageSize.height > 0
    else { return nil }
    let shown = shownSize
    let scale = min(stageSize.width / shown.width, stageSize.height / shown.height)
    let rendered = CGSize(width: shown.width * scale, height: shown.height * scale)
    let origin = CGPoint(
      x: (stageSize.width - rendered.width) / 2,
      y: (stageSize.height - rendered.height) / 2)
    let x = min(max(0, (point.x - origin.x) / rendered.width), 0.9999)
    let y = min(max(0, (point.y - origin.y) / rendered.height), 0.9999)
    return unrotate(CGPoint(x: x, y: y))
  }

  /// Undo the presentation rotation: the device wants the point in its own
  /// panel's coordinates, not in the ones we drew.
  private func unrotate(_ point: CGPoint) -> CGPoint {
    switch rotation {
    case 90: CGPoint(x: point.y, y: 1 - point.x)
    case 180: CGPoint(x: 1 - point.x, y: 1 - point.y)
    case 270: CGPoint(x: 1 - point.y, y: point.x)
    default: point
    }
  }

  private func send(_ point: CGPoint, phase: Int) {
    guard let normalized = normalize(point) else { return }
    interacted = true
    app.deviceTouch(
      deviceId: deviceId, platform: platform,
      x: normalized.x, y: normalized.y, eventType: phase)
  }

  private func sendButton(_ button: String) {
    interacted = true
    app.deviceButton(deviceId: deviceId, platform: platform, button: button)
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
      if platform == .ios {
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

  private func rotate() {
    let next = (deviceState?.orientation ?? .portrait).next
    busy = true
    Task {
      await app.setDeviceOrientation(
        deviceId: deviceId, platform: platform, orientation: next)
      busy = false
    }
  }

  private func toggleFold(_ fold: RemoteFoldState) {
    busy = true
    Task {
      await app.setDeviceFold(
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
    if watchStart == nil { watchStart = Date() }

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

    // Take the device unless someone else is already driving it; the host
    // pushes `device.claim` from here on.
    if app.hasControl {
      await app.loadClaimStatus(deviceId: deviceId)
      if otherHolder == nil {
        await app.claimDevice(deviceId: deviceId)
      }
    }

    // Seed the pose; the host pushes `device.state` from here on while it is
    // being watched.
    if let state = await app.deviceState(deviceId: deviceId, platform: platform) {
      app.deviceStates[deviceId] = state
    }

    Task {
      try? await Task.sleep(for: Self.noVideoTimeout)
      if status == .connecting { status = .noVideo }
    }
  }

  /// The claim, when someone other than this phone holds it.
  private var otherHolder: RemoteDeviceClaim? {
    guard let holder = app.deviceClaims[deviceId]?.holder else { return nil }

    return holder.connectionId == app.connectionId ? nil : holder
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
      await app.releaseDevice(deviceId: deviceId)
      await app.unwatchDevice(deviceId: deviceId)
    }
  }
}
