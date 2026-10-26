import ArgusUI
import SwiftUI

/// A device in its own floating window: the same picture and controls as the
/// panel, fixed on one device. Closes itself when the host says the device went.
struct DevicePopoutView: View {
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  @Environment(RuntimeModel.self) private var runtime
  let target: DevicePopoutTarget

  private var remote: RemotePlatform { target.platform == "android" ? .android : .ios }
  private var key: String { "\(target.platform):\(target.deviceKey)" }

  private var name: String {
    remote == .ios
      ? runtime.simulator(target.deviceKey)?.displayName ?? "Simulator"
      : runtime.androidDevice(target.deviceKey)?.name ?? "Emulator"
  }

  private var isTv: Bool {
    remote == .ios
      ? runtime.simulator(target.deviceKey)?.runtime.hasPrefix("tvOS") ?? false
      : runtime.androidDevice(target.deviceKey)?.isTv ?? false
  }

  var body: some View {
    VStack(spacing: 0) {
      RuntimeDeviceActions(
        platform: remote, deviceId: target.deviceKey, sessionId: nil, isTv: isTv,
        clearsSelection: false)
      Divider()
      RuntimeDeviceView(deviceId: target.deviceKey, platform: remote, isTv: isTv)
    }
    .background(theme.bg)
    .navigationTitle(name)
    .task {
      runtime.popoutOpened(key)
      if runtime.simulators.isEmpty && runtime.androidDevices.isEmpty { await runtime.refresh() }
    }
    .onChange(of: runtime.closedPopouts.contains(key)) { _, closed in
      if closed { dismiss() }
    }
  }
}
