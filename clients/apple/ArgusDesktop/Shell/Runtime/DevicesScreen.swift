import ArgusUI
import SwiftUI

/// `/devices`: every simulator, emulator and browser the host knows, who
/// holds it, and boot / shut down / pop out — the renderer's `DevicesScreen`.
struct DevicesScreen: View {
  enum Mode: String { case table, grid }

  @Environment(\.theme) private var theme
  @Environment(\.openWindow) private var openWindow
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime

  /// The device whose details are open. `nil` keeps its own state; the
  /// `/devices/:platform/:deviceKey` route passes a binding instead.
  var selection: Binding<DeviceRef?>?

  @State private var localSelection: DeviceRef?
  @AppStorage("devices.viewMode") private var mode = Mode.table
  @AppStorage("devices.tileSize") private var tileSize = 220.0
  @State private var devices: [ArgusProtocol.DeviceInfo] = []
  /// Until the first list arrives, no devices means "not known yet".
  @State private var loaded = false
  @State private var error: String?
  @State private var busy: Set<String> = []
  /// Why the last boot or shutdown from this screen failed.
  @State private var actionError: String?
  /// Online devices shown as live tiles in the grid, in the order picked.
  @State private var gridKeys: [String] = []

  private static let pollInterval = Duration.seconds(3)

  private var online: [ArgusProtocol.DeviceInfo] { devices.filter(\.online) }

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      if let actionError {
        Label(actionError, systemImage: Icon.warning)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.error)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
        Divider()
      }
      if let error {
        hint("Failed to list devices: \(error)")
      } else if !loaded {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if devices.isEmpty {
        hint("No devices found. Start an agent or boot a simulator to see devices here.")
      } else if mode == .table {
        table
      } else {
        grid
      }
    }
    .background(theme.bg)
    .navigationTitle("Devices")
    .sheet(item: selectedDevice) { device in
      DeviceDetailSheet(
        device: device, busy: busy.contains(device.deviceKey),
        onBoot: { boot(device) }, onShutdown: { stop(device) },
        onPopout: { popout(device) },
        onOpen: { agent in
          selected = nil
          open(device, agent: agent)
        },
        onOpenProject: {
          selected = nil
          openProject(device)
        },
        onRepaired: {
          selected = nil
          Task { await load() }
        },
        onClose: { selected = nil })
    }
    // The shown machine's devices; a tile streams from it too.
    .task(id: "\(store.connection == .ready)|\(model.hosts.focused)") {
      runtime.hostId = model.hosts.focused
      while !Task.isCancelled {
        await load()
        try? await Task.sleep(for: Self.pollInterval)
      }
    }
  }

  private var header: some View {
    HStack(spacing: 12) {
      Text(
        "\(devices.count) total · \(online.count) running · \(devices.filter(\.reserved).count) reserved"
      )
      .font(.scaled(size: 12))
      .foregroundStyle(theme.textMuted)
      Spacer()
      if mode == .grid {
        Slider(value: $tileSize, in: 140...420, step: 10)
          .frame(width: 140)
          .accessibilityLabel("Tile size")
      }
      Picker("View", selection: $mode) {
        Text("Table").tag(Mode.table)
        Text("Grid").tag(Mode.grid)
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .fixedSize()
    }
    .padding(.horizontal, 12)
    .frame(height: 40)
  }

  private func hint(_ text: String) -> some View {
    Text(text)
      .font(.scaled(size: 12))
      .foregroundStyle(theme.textMuted)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  // MARK: Table

  /// `Table` wants identifiable rows; the wire type isn't.
  private struct Row: Identifiable {
    let device: ArgusProtocol.DeviceInfo
    var id: String { device.rowId }
  }

  private var table: some View {
    Table(devices.map(Row.init)) {
      TableColumn("Device") { (row: Row) in
        HStack(spacing: 6) {
          StatusDot(tone: row.device.online ? .success : .muted, pulse: false)
          Button(row.device.displayName) { selected = DeviceRef(row.device) }
            .buttonStyle(.plain)
            .lineLimit(1)
            .help("Show details")
        }
        .contextMenu { menu(row.device) }
      }
      .width(min: 140, ideal: 200)
      TableColumn("Platform") { (row: Row) in
        Text(row.device.platform.rawValue).foregroundStyle(theme.textMuted)
      }
      .width(70)
      TableColumn("Runtime") { (row: Row) in
        Text(row.device.runtime.flatMap { $0.isEmpty ? nil : $0 } ?? "—")
      }
      TableColumn("Agent") { (row: Row) in
        link(row.device.agentId.map { String($0.prefix(8)) }) { open(row.device, agent: true) }
      }
      TableColumn("Session") { (row: Row) in
        link(row.device.sessionId.map { String($0.prefix(8)) }) { open(row.device, agent: false) }
      }
      TableColumn("Project") { (row: Row) in
        Text(row.device.repoRoot.map { ($0 as NSString).lastPathComponent } ?? "—")
      }
      TableColumn("") { (row: Row) in actions(row.device) }
        .width(70)
    }
  }

  private func link(_ label: String?, run: @escaping () -> Void) -> some View {
    Group {
      if let label {
        Button(label, action: run).buttonStyle(.accentLink)
      } else {
        Text("—").foregroundStyle(theme.textMuted)
      }
    }
  }

  @ViewBuilder
  private func actions(_ device: ArgusProtocol.DeviceInfo) -> some View {
    HStack(spacing: 6) {
      if let problem = device.problem {
        Image(systemName: Icon.warning)
          .foregroundStyle(theme.warning)
          .help("\(problem.message) Open its details to erase or delete it.")
          .accessibilityLabel(problem.message)
      } else if device.platform == .ios, !device.online {
        iconButton("Boot simulator", "power.circle") { boot(device) }
          .disabled(busy.contains(device.deviceKey))
      }
      if device.platform != .web, device.online {
        iconButton("Shut down", "stop.circle") { stop(device) }
          .disabled(busy.contains(device.deviceKey))
      }
      if device.platform != .web {
        iconButton("Open in floating window", "rectangle.portrait.on.rectangle.portrait") {
          popout(device)
        }
      }
    }
  }

  private func iconButton(_ label: String, _ icon: String, run: @escaping () -> Void) -> some View {
    Button(action: run) { Image(systemName: icon) }
      .buttonStyle(.borderless)
      .help(label)
      .accessibilityLabel(label)
  }

  @ViewBuilder
  private func menu(_ device: ArgusProtocol.DeviceInfo) -> some View {
    Button("Show Details") { selected = DeviceRef(device) }
    if device.sessionId != nil {
      Button("Open Session") { open(device, agent: false) }
    }
    if device.agentId != nil {
      Button("Open Agent") { open(device, agent: true) }
    }
    if device.platform != .web {
      Button("Open in Floating Window") { popout(device) }
    }
    Divider()
    Button("Stop Device", role: .destructive) { stop(device) }
      .disabled(!device.online)
  }

  // MARK: Grid

  private var grid: some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(online.filter { $0.platform != .web }, id: \.rowId) { device in
            let on = gridKeys.contains(device.deviceKey)
            Toggle(device.displayName, isOn: Binding(
              get: { on },
              set: { show in
                if show { gridKeys.append(device.deviceKey) } else {
                  gridKeys.removeAll { $0 == device.deviceKey }
                }
              }))
            .toggleStyle(.button)
            .controlSize(.small)
          }
        }
        .padding(8)
      }
      Divider()
      ScrollView {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: tileSize), spacing: 8)], spacing: 8) {
          ForEach(gridDevices, id: \.rowId) { device in
            VStack(spacing: 4) {
              RuntimeDeviceView(
                deviceId: device.deviceKey, platform: device.platform == .android ? .android : .ios,
                isTv: device.runtime?.hasPrefix("tvOS") ?? false)
                .frame(height: tileSize * 2)
                .clipShape(.rect(cornerRadius: theme.radiusSmall))
              Text(device.displayName).font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
            }
          }
        }
        .padding(8)
      }
    }
  }

  private var gridDevices: [ArgusProtocol.DeviceInfo] {
    gridKeys.compactMap { key in online.first { $0.deviceKey == key && $0.platform != .web } }
  }

  // MARK: Actions

  private func load() async {
    guard let backend = store.backend, store.connection == .ready else { return }
    do {
      devices = try await backend.request(ArgusProtocol.Commands.ListDevices.self, .init())
      loaded = true
      error = nil
      gridKeys.removeAll { key in !online.contains { $0.deviceKey == key } }
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  private func boot(_ device: ArgusProtocol.DeviceInfo) {
    busy.insert(device.deviceKey)
    actionError = nil
    Task {
      do {
        try await runtime.bootSimulator(device.deviceKey)
        MacTelemetry.capture(.devicePower(action: .boot, platform: device.platform.rawValue))
      } catch {
        actionError = "\(device.name): \(HostStore.describe(error))"
      }
      busy.remove(device.deviceKey)
      await load()
    }
  }

  private func stop(_ device: ArgusProtocol.DeviceInfo) {
    busy.insert(device.deviceKey)
    actionError = nil
    Task {
      do {
        try await store.backend?.request(
          ArgusProtocol.Commands.StopDevice.self,
          .init(deviceKey: device.deviceKey, platform: device.platform))
        MacTelemetry.capture(.devicePower(action: .shutdown, platform: device.platform.rawValue))
      } catch {
        actionError = "\(device.name): \(HostStore.describe(error))"
      }
      busy.remove(device.deviceKey)
      await load()
    }
  }

  private func popout(_ device: ArgusProtocol.DeviceInfo) {
    openWindow(value: DevicePopoutTarget(platform: device.platform.rawValue, deviceKey: device.deviceKey))
    MacTelemetry.capture(.devicePopoutOpened(platform: device.platform.rawValue))
  }

  private var selected: DeviceRef? {
    get { selection?.wrappedValue ?? localSelection }
    nonmutating set {
      if let selection { selection.wrappedValue = newValue } else { localSelection = newValue }
    }
  }

  /// The selected device while the host still lists it.
  private var selectedDevice: Binding<ArgusProtocol.DeviceInfo?> {
    Binding(
      get: { selected.flatMap { ref in devices.first(where: ref.matches) } },
      set: { if $0 == nil { selected = nil } })
  }

  /// The project's own checkout, as the renderer's "open project" lands on it.
  private func openProject(_ device: ArgusProtocol.DeviceInfo) {
    guard let repoRoot = device.repoRoot,
      let root = store.sessionsByRepo[repoRoot]?.first(where: { $0.kind == .projectRoot })
    else { return }
    model.openAgents(session: root.id)
  }

  private func open(_ device: ArgusProtocol.DeviceInfo, agent: Bool) {
    guard let sessionId = device.sessionId else { return }
    model.navigate(.session(id: sessionId, agentId: agent ? device.agentId : nil))
  }
}

extension ArgusProtocol.DeviceInfo: @retroactive Identifiable {
  public var id: String { rowId }
}

extension ArgusProtocol.DeviceInfo {
  /// A UDID and an Android serial can collide; the platform keeps rows apart.
  var rowId: String { "\(platform.rawValue):\(deviceKey)" }
}
