import ArgusUI
import SwiftUI

/// The iOS or Android side of the panel: the picked device's state decides
/// between a hint, a Boot button and the live picture with its controls.
struct RuntimeNativeView: View {
  @Environment(\.theme) private var theme
  @Environment(RuntimeModel.self) private var runtime
  let platform: RuntimeModel.Platform
  let sessionId: String?

  /// Devices this view already tried to boot, so one that can't come up
  /// isn't retried on every refresh. Reselecting clears it.
  @State private var autoBooted: Set<String> = []
  @State private var bootError: String?

  private var selected: String? { runtime.selectedDevice(platform: platform, session: sessionId) }

  var body: some View {
    Group {
      if let error = toolsError {
        hint(
          title: platform == .ios ? "Xcode Command Line Tools Required" : "Android SDK Required",
          detail: platform == .ios ? "Run xcode-select --install in Terminal to install them." : error)
      } else if let device = selected, let target = target(device) {
        if target.online {
          VStack(spacing: 0) {
            RuntimeDeviceActions(
              platform: target.remote, deviceId: target.id, sessionId: sessionId,
              isTv: target.isTv)
            Divider()
            RuntimeDeviceView(deviceId: target.id, platform: target.remote, isTv: target.isTv)
              // A fresh view per host: the same simulator can be listed by two.
              .id("\(runtime.hostId)|\(target.id)")
          }
        } else {
          bootPrompt(target)
        }
      } else {
        hint(
          title: platform == .ios ? "No simulator picked" : "No emulator picked",
          detail: "Pick a device from the menu above to see it here.")
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // Again once the lists load: a launch restores the pick before it can be seen.
    .task(id: "\(selected ?? "")|\(selected.flatMap(target) != nil)") { await autoBoot() }
  }

  private var toolsError: String? {
    platform == .ios ? runtime.iosToolsError : runtime.androidToolsError
  }

  private struct Target {
    var id: String
    var name: String
    var online: Bool
    var isTv: Bool
    var remote: RemotePlatform
    var avdName: String?
    var problem: ArgusProtocol.SimulatorProblem?
  }

  private func target(_ id: String) -> Target? {
    switch platform {
    case .ios:
      return runtime.simulator(id).map {
        Target(
          id: $0.udid, name: $0.name, online: $0.booted, isTv: $0.runtime.hasPrefix("tvOS"),
          remote: .ios, problem: $0.problem)
      }
    case .android:
      return runtime.androidDevice(id).map {
        Target(
          id: $0.serial, name: $0.name, online: $0.online, isTv: $0.isTv, remote: .android,
          avdName: $0.avdName)
      }
    case .web:
      return nil
    }
  }

  @ViewBuilder
  private func bootPrompt(_ target: Target) -> some View {
    let booting = runtime.booting.contains(target.avdName ?? target.id)
    VStack(spacing: 12) {
      Image(systemName: target.isTv ? "appletv" : "iphone")
        .font(.scaled(size: 40, weight: .thin))
        .foregroundStyle(theme.textMuted)
      Text(target.name).font(.scaled(size: 13, weight: .medium))
      if let problem = target.problem {
        SimulatorProblemView(udid: target.id, name: target.name, problem: problem) {
          autoBooted.remove(target.id)
          bootError = nil
        }
      } else {
        Button(booting ? "Booting…" : "Boot") { Task { await boot(target) } }
          .disabled(booting)
      }
      if let bootError, target.problem == nil {
        Text(bootError).font(.scaled(size: 11)).foregroundStyle(theme.error)
          .multilineTextAlignment(.center)
      }
    }
    .padding(24)
  }

  private func hint(title: String, detail: String) -> some View {
    VStack(spacing: 6) {
      Text(title).font(.scaled(size: 13, weight: .medium))
      Text(detail).font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
        .multilineTextAlignment(.center)
    }
    .padding(24)
  }

  /// Picking a shut-down simulator is the request to see it, as on the desktop:
  /// boot it. An AVD waits for its Boot button, as there.
  private func autoBoot() async {
    bootError = nil
    guard platform == .ios, let id = selected, let target = target(id), !target.online,
      target.problem == nil, !autoBooted.contains(id)
    else { return }
    autoBooted.insert(id)
    await boot(target)
  }

  private func boot(_ target: Target) async {
    bootError = nil
    do {
      if let avd = target.avdName, platform == .android {
        let serial = try await runtime.bootAvd(avd)
        runtime.select(platform: .android, device: serial, session: sessionId)
      } else {
        try await runtime.bootSimulator(target.id)
      }
      MacTelemetry.capture(.devicePower(action: .boot, platform: target.remote.rawValue))
    } catch {
      bootError = HostStore.describe(error)
      // The host may only now see why it can't boot; the list says so.
      await runtime.refresh()
    }
  }
}

/// The hardware and session controls above the picture: the renderer's
/// floating action bar.
struct RuntimeDeviceActions: View {
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime
  let platform: RemotePlatform
  let deviceId: String
  let sessionId: String?
  /// A TV has its remote for Home, and nothing to rotate.
  var isTv = false
  /// A popout has no runtime target to clear when the device goes.
  var clearsSelection = true

  @State private var busy = false

  private var state: RemoteDeviceState? { store.deviceStates[deviceId] }

  var body: some View {
    HStack(spacing: 2) {
      if isTv {
        EmptyView()
      } else if platform == .ios {
        action("Home (⌘⇧H)", Icon.home) { button("ios_home") }
        action("Rotate device", Icon.rotate) { rotate() }.disabled(busy)
      } else {
        action("Back", Icon.androidBack) { button("back") }
        action("Home", Icon.home) { button("home") }
        action("Recents", Icon.androidRecents) { button("recents") }
      }
      if let fold = state?.fold {
        action(fold.pose == .open ? "Fold device" : "Unfold device", Icon.fold) { toggleFold(fold) }
          .disabled(busy)
      }
      RuntimeLinkMenu(deviceId: deviceId)
      Spacer()
      action("Disconnect device", "xmark.circle") { disconnect() }
    }
    .padding(.horizontal, 8)
    .frame(height: 30)
  }

  private func action(_ label: String, _ icon: String, run: @escaping () -> Void) -> some View {
    Button(action: run) {
      Image(systemName: icon).frame(width: 22, height: 22)
    }
    .buttonStyle(.borderless)
    .help(label)
    .accessibilityLabel(label)
  }

  private func button(_ id: String) {
    store.deviceButton(deviceId: deviceId, platform: platform, button: id)
  }

  private func rotate() {
    let next = (state?.orientation ?? .portrait).next
    busy = true
    Task {
      await store.setDeviceOrientation(deviceId: deviceId, platform: platform, orientation: next)
      busy = false
    }
  }

  private func toggleFold(_ fold: RemoteFoldState) {
    busy = true
    Task {
      await store.setDeviceFold(
        deviceId: deviceId, platform: platform, pose: fold.pose == .open ? .closed : .open)
      busy = false
    }
  }

  /// Stops the capture and closes its popouts; the device itself keeps running.
  private func disconnect() {
    Task {
      await runtime.disconnect(platform: platform == .ios ? .ios : .android, device: deviceId)
      MacTelemetry.capture(.devicePower(action: .disconnect, platform: platform.rawValue))
      if clearsSelection {
        runtime.select(
          platform: platform == .ios ? .ios : .android, device: nil, session: sessionId)
      }
    }
  }
}

/// The project's `.argus.json#simulator_deeplinks`, folders as submenus, fired
/// into the device with `device_open_link`.
struct RuntimeLinkMenu: View {
  @Environment(HostStore.self) private var store
  @Environment(RuntimeModel.self) private var runtime
  let deviceId: String

  var body: some View {
    Menu {
      let links = runtime.projectConfig?.simulatorDeeplinks ?? []
      if links.isEmpty {
        Text("No deep links configured")
      } else {
        items(links)
      }
    } label: {
      Image(systemName: Icon.link)
    }
    .menuStyle(.borderlessButton)
    .menuIndicator(.hidden)
    .fixedSize()
    .help("Open deep link")
  }

  private func items(_ entries: [ArgusProtocol.SimulatorDeeplinkConfig]) -> AnyView {
    AnyView(
      ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
        if let children = entry.children, !children.isEmpty {
          Menu(entry.label) { items(children) }
        } else if let url = entry.url {
          Button(entry.label) { open(url) }
        }
      })
  }

  private func open(_ url: String) {
    Task {
      _ = try? await store.backend?.request(
        ArgusProtocol.Commands.DeviceOpenLink.self, .init(deviceKey: deviceId, url: url))
    }
  }
}
