import ArgusCore
import ArgusUI
import SwiftUI

/// A side panel's Device or Browser tab: a target picker over the picked
/// simulator or emulator, or the session's browser — the renderer's `RuntimeView`.
struct RuntimePanel: View {
  @Environment(\.theme) private var theme
  @Environment(\.openWindow) private var openWindow
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime
  @Environment(DesktopModel.self) private var model
  let sessionId: String?
  /// The Browser tab; otherwise the Device tab.
  var browser = false
  @State private var titleBarWidth: CGFloat = 0

  /// How often the device lists are refetched while the panel is up.
  private static let pollInterval = Duration.seconds(5)

  private var platform: RuntimeModel.Platform { browser ? .web : runtime.devicePlatform }

  /// Native inspection is Apple-only, and only while its tool is on.
  private var inspectorAvailable: Bool {
    platform == .ios && runtime.toolEnabled("device-inspector")
  }

  private var logsAvailable: Bool {
    platform != .web && selectedDevice != nil && runtime.toolEnabled("device-debug")
  }

  /// The session's machine, or the shown one off a session. Reads the
  /// session list so a host that attaches after launch re-points the panel.
  private var panelHost: HostId {
    guard let sessionId, store.repoRoot(forSessionId: sessionId) != nil else { return model.hosts.focused }
    return model.host(ofSession: sessionId)
  }

  private var selectedDevice: String? {
    runtime.selectedDevice(platform: platform, session: sessionId)
  }

  var body: some View {
    VStack(spacing: 0) {
      if !browser {
        titleBar
        Divider()
      }
      content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .background(theme.bg)
    .task(id: browser) {
      // The browser needs no device lists.
      while !browser, !Task.isCancelled {
        await runtime.refresh()
        try? await Task.sleep(for: Self.pollInterval)
      }
    }
    .task(id: "\(sessionId ?? "")|\(store.connection == .ready)|\(panelHost)") {
      if runtime.hostId != panelHost {
        runtime.hostId = panelHost
        await runtime.refresh()
      }
      await runtime.loadProject(repoRoot: sessionId.flatMap { store.repoRoot(forSessionId: $0) })
    }
    .onChange(of: "\(inspectorAvailable)|\(logsAvailable)") {
      if runtime.mode == .inspect && !inspectorAvailable || runtime.mode == .logs && !logsAvailable {
        runtime.mode = .simulate
      }
    }
  }

  @ViewBuilder
  private var content: some View {
    if let sessionId, store.repoRoot(forSessionId: sessionId) == nil {
      // Its machine isn't known yet (a host still attaching): waiting beats
      // grabbing this Mac's device of the same name.
      ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      devicePane
    }
  }

  @ViewBuilder
  private var devicePane: some View {
    switch platform {
    case .web:
      RuntimeBrowserView(sessionKey: sessionId ?? RuntimeModel.globalKey)
    case .ios where runtime.mode == .inspect && inspectorAvailable:
      InspectionView(deviceKey: selectedDevice)
    case .ios where runtime.mode == .logs && logsAvailable,
      .android where runtime.mode == .logs && logsAvailable:
      RuntimeLogsView(deviceKey: selectedDevice ?? "")
    case .ios, .android:
      RuntimeNativeView(platform: platform, sessionId: sessionId)
    }
  }

  /// The modes as the view switcher's pills; unselected ones drop their titles when the column is narrow.
  private var modePicker: some View {
    var modes: [PillTab<RuntimeModel.Mode>] = [PillTab(id: .simulate, title: "Simulate", symbol: "iphone")]
    if inspectorAvailable { modes.append(PillTab(id: .inspect, title: "Inspect", symbol: "viewfinder")) }
    if logsAvailable { modes.append(PillTab(id: .logs, title: "Logs", symbol: "text.alignleft")) }
    return PillTabBar(
      tabs: modes, selection: runtime.mode, compact: true, iconsOnly: titleBarWidth < Self.titledModesWidth,
      framed: true
    ) { runtime.mode = $0 }
    .accessibilityLabel("Runtime mode")
  }

  /// Below this the device picker and titled modes don't fit side by side.
  private static let titledModesWidth: CGFloat = 520

  private var titleBar: some View {
    HStack(spacing: 8) {
      RuntimeTargetPicker(sessionId: sessionId)
      if inspectorAvailable || logsAvailable {
        modePicker.fixedSize()
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
        .buttonStyle(.argusBorderless)
        .help("Open in floating window")
        .accessibilityLabel("Open in floating window")
      }
    }
    .padding(.horizontal, 10)
    .frame(height: 38)
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { titleBarWidth = $0 }
  }
}

/// Platform and device in one menu: picking a device implies its platform. The
/// browser is a tab of its own.
struct RuntimeTargetPicker: View {
  @Environment(RuntimeModel.self) private var runtime
  @Environment(DesktopModel.self) private var model
  let sessionId: String?

  var body: some View {
    Menu {
      Section("iOS Simulators") {
        if runtime.simulators.isEmpty { Text(runtime.iosToolsError == nil ? "None" : "Unavailable") }
        ForEach(runtime.simulators, id: \.udid) { device in
          toggle(
            "\(device.displayName)\(device.booted ? " — booted" : device.problem != nil ? " — can't boot" : "")",
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
    } label: {
      Label(label, systemImage: Icon.simulator)
    }
    .menuStyle(.borderlessButton)
    .clickable()
    // A long device name truncates rather than push the toolbar out.
    .frame(maxWidth: 200, alignment: .leading)
    .accessibilityLabel("Runtime target")
  }

  private func isSelected(_ platform: RuntimeModel.Platform, _ id: String) -> Bool {
    runtime.devicePlatform == platform && runtime.selectedDevice(platform: platform, session: sessionId) == id
  }

  private func toggle(_ title: String, on: Bool, run: @escaping () -> Void) -> some View {
    Toggle(title, isOn: Binding(get: { on }, set: { _ in run() }))
  }

  private var label: String {
    switch runtime.devicePlatform {
    case .web: return "Chromium"
    case .ios:
      return runtime.simulator(runtime.selectedDevice(platform: .ios, session: sessionId))?.displayName
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
