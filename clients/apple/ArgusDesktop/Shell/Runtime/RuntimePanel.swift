import ArgusUI
import SwiftUI

/// The runtime column: a target picker over the picked simulator, emulator or
/// the session's browser — the renderer's `RuntimeView`.
struct RuntimePanel: View {
  @Environment(\.theme) private var theme
  @Environment(\.openWindow) private var openWindow
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime
  let sessionId: String?

  /// How often the device lists are refetched while the panel is up.
  private static let pollInterval = Duration.seconds(5)

  private var platform: RuntimeModel.Platform { runtime.platform }

  /// Native inspection is Apple-only, and only while its tool is on.
  private var inspectorAvailable: Bool {
    platform == .ios && runtime.toolEnabled("device-inspector")
  }

  private var selectedDevice: String? {
    runtime.selectedDevice(platform: platform, session: sessionId)
  }

  var body: some View {
    VStack(spacing: 0) {
      titleBar
      Divider()
      content
    }
    .background(theme.bg)
    .task {
      while !Task.isCancelled {
        await runtime.refresh()
        try? await Task.sleep(for: Self.pollInterval)
      }
    }
    .task(id: "\(sessionId ?? "")|\(store.connection == .ready)") {
      await runtime.loadProject(repoRoot: sessionId.flatMap { store.repoRoot(forSessionId: $0) })
    }
    .onChange(of: inspectorAvailable) { _, available in
      if !available { runtime.mode = .simulate }
    }
  }

  @ViewBuilder
  private var content: some View {
    switch platform {
    case .web:
      RuntimeBrowserView(sessionKey: sessionId ?? RuntimeModel.globalKey)
    case .ios where runtime.mode == .inspect && inspectorAvailable:
      InspectionView(deviceKey: selectedDevice)
    case .ios, .android:
      RuntimeNativeView(platform: platform, sessionId: sessionId)
    }
  }

  private var titleBar: some View {
    HStack(spacing: 8) {
      RuntimeTargetPicker(sessionId: sessionId)
      if inspectorAvailable {
        @Bindable var runtime = runtime
        Picker("Runtime mode", selection: $runtime.mode) {
          Text("Simulate").tag(RuntimeModel.Mode.simulate)
          Text("Inspect").tag(RuntimeModel.Mode.inspect)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
      }
      Spacer(minLength: 0)
      // The browser belongs to its session's panel; everything else detaches.
      if platform != .web, let device = selectedDevice {
        Button {
          openWindow(value: DevicePopoutTarget(platform: platform.rawValue, deviceKey: device))
          MacTelemetry.capture(.devicePopoutOpened(platform: platform.rawValue))
        } label: {
          Image(systemName: "rectangle.portrait.on.rectangle.portrait")
        }
        .buttonStyle(.borderless)
        .help("Open in floating window")
        .accessibilityLabel("Open in floating window")
      }
    }
    .padding(.horizontal, 10)
    .frame(height: 38)
  }
}

/// Platform and device in one menu: picking a device implies its platform.
struct RuntimeTargetPicker: View {
  @Environment(RuntimeModel.self) private var runtime
  let sessionId: String?

  var body: some View {
    Menu {
      Section("iOS Simulators") {
        if runtime.simulators.isEmpty { Text(runtime.iosToolsError == nil ? "None" : "Unavailable") }
        ForEach(runtime.simulators, id: \.udid) { device in
          toggle(
            "\(device.name)\(device.booted ? " — booted" : "")",
            on: isSelected(.ios, device.udid)
          ) { runtime.select(platform: .ios, device: device.udid, session: sessionId) }
        }
      }
      Section("Android Emulators") {
        if runtime.androidDevices.isEmpty {
          Text(runtime.androidToolsError == nil ? "None" : "Unavailable")
        }
        ForEach(runtime.androidDevices, id: \.serial) { device in
          toggle(
            "\(device.name)\(device.online ? " — running" : "")",
            on: isSelected(.android, device.serial)
          ) { runtime.select(platform: .android, device: device.serial, session: sessionId) }
        }
      }
      Section("Web") {
        toggle("Chromium", on: runtime.platform == .web) {
          runtime.select(platform: .web, device: nil, session: sessionId)
        }
      }
    } label: {
      Label(label, systemImage: runtime.platform == .web ? Icon.web : Icon.simulator)
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .accessibilityLabel("Runtime target")
  }

  private func isSelected(_ platform: RuntimeModel.Platform, _ id: String) -> Bool {
    runtime.platform == platform && runtime.selectedDevice(platform: platform, session: sessionId) == id
  }

  private func toggle(_ title: String, on: Bool, run: @escaping () -> Void) -> some View {
    Toggle(title, isOn: Binding(get: { on }, set: { _ in run() }))
  }

  private var label: String {
    switch runtime.platform {
    case .web: return "Chromium"
    case .ios:
      return runtime.simulator(runtime.selectedDevice(platform: .ios, session: sessionId))?.name
        ?? "Pick device"
    case .android:
      return runtime.androidDevice(runtime.selectedDevice(platform: .android, session: sessionId))?
        .name ?? "Pick device"
    }
  }
}

/// What a device popout window shows; codable so the window can be restored.
struct DevicePopoutTarget: Codable, Hashable {
  var platform: String
  var deviceKey: String
}
