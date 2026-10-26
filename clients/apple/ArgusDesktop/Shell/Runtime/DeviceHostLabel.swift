import ArgusCore

/// A device's name, with the device host it runs on when it isn't the host's own Mac.
private func withDeviceHost(_ name: String, _ label: String?) -> String {
  label.map { "\(name) on \($0)" } ?? name
}

extension ArgusProtocol.SimulatorDevice {
  var displayName: String { withDeviceHost(name, deviceHostLabel) }
}

extension ArgusProtocol.DeviceInfo {
  var displayName: String { withDeviceHost(name, deviceHostLabel) }
}
