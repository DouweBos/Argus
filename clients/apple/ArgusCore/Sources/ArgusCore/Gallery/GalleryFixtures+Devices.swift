import ArgusKit
import Foundation

/// The simulators, emulators and browser a busy computer knows, in both the
/// Mac's `list_devices` and the phone's `devices.list` shapes.
extension GalleryFixtures {
  private struct Device {
    let key: String
    let name: String
    let platform: String
    let runtime: String?
    let online: Bool
    var agent: String?
    var project: String?
    var hostLabel: String?
    var capturing = false
  }

  private static let devices: [Device] = [
    Device(
      key: "5B1E2C40-1A6F-4F0E-9D1A-0C7E3B2A9F11", name: "iPhone 17 Pro", platform: "ios", runtime: "iOS 26.1",
      online: true, agent: "a1f3c9e2", project: "Argus", capturing: true),
    Device(
      key: "A9C3E5F7-2B4D-4E6F-8A1B-3C5D7E9F1A2B", name: "iPad Pro 13-inch (M5)", platform: "ios",
      runtime: "iOS 26.1", online: true, agent: "b7d2e4f6", project: "react-native-client"),
    Device(
      key: "emulator-5554", name: "Pixel 9 Pro", platform: "android", runtime: "Android 15 (API 35)", online: true,
      agent: "c3e5a7b9", project: "react-native-client"),
    Device(
      key: "D4E6F8A0-3C5E-4A7B-9C1D-5E7F9A1B3C5D", name: "iPhone 17", platform: "ios", runtime: "iOS 26.1",
      online: true, hostLabel: "Studio Mac mini"),
    Device(
      key: "browser-main", name: "Browser", platform: "web", runtime: nil, online: true, agent: "a1f3c9e2",
      project: "Argus"),
    Device(
      key: "F1A3B5C7-4D6E-4F8A-0B2C-6D8E0F2A4B6C", name: "Apple TV 4K (3rd generation)", platform: "ios",
      runtime: "tvOS 26.0", online: false),
    Device(
      key: "E2F4A6B8-5C7D-4E9F-1A3B-7C9D1E3F5A7B", name: "iPhone 16e", platform: "ios", runtime: "iOS 18.6",
      online: false),
    Device(
      key: "Medium_Phone_API_36", name: "Medium Phone API 36", platform: "android", runtime: "Android 16 (API 36)",
      online: false),
  ]

  /// The Devices screen on the Mac and the phone.
  public static var deviceList: [String: String] {
    let mac: [[String: Any]] = devices.map { device in
      var json: [String: Any] = [
        "deviceKey": device.key, "name": device.name, "online": device.online, "platform": device.platform,
        "reservationKey": "\(device.platform):\(device.key)", "reserved": device.agent != nil,
      ]
      json["runtime"] = device.runtime
      json["agentId"] = device.agent
      json["sessionId"] = device.agent.map { "s-\($0)" }
      json["repoRoot"] = device.project.map { "/Users/dev/Projects/\($0)" }
      json["deviceHostLabel"] = device.hostLabel
      return json
    }
    let phone: [[String: Any]] = devices.filter { $0.platform != "web" }.map { device in
      var json: [String: Any] = [
        "id": device.key, "platform": device.platform, "name": device.name, "booted": device.online,
        "capturing": device.capturing, "is_tv": device.runtime?.hasPrefix("tvOS") ?? false,
      ]
      json["runtime"] = device.runtime
      json["device_host_label"] = device.hostLabel
      return json
    }
    return [
      ArgusProtocol.Commands.ListDevices.name: GalleryJSON.encode(mac),
      RemoteMethod.devicesList.rawValue: GalleryJSON.encode(["devices": phone]),
    ]
  }
}
