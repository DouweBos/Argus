import Foundation

/// EAS Simulator devices (`eas:<hostId>:<slot>`) start a billed Expo session
/// when booted; watching one that already runs costs nothing extra.
public enum EasBilling {
  public static let startTitle = "Start an EAS Simulator session?"
  public static let startConfirm = "Start session (billed)"

  /// The EAS host behind a device id, or nil for any other device.
  public static func hostId(of deviceId: String) -> String? {
    let parts = deviceId.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0] == "eas", !parts[1].isEmpty, Int(parts[2]) != nil else {
      return nil
    }
    return String(parts[1])
  }

  /// Booting this device would start a billed session.
  public static func isBillableStart(deviceId: String, running: Bool) -> Bool {
    !running && hostId(of: deviceId) != nil
  }

  /// The cost warning, with the host's limits when known.
  public static func startMessage(idleMinutes: Int?, maxSessionMinutes: Int?) -> String {
    let until =
      if let idleMinutes, let maxSessionMinutes {
        "until you end it, it sits idle for \(idleMinutes) min, or it reaches its \(maxSessionMinutes) min limit"
      } else {
        "until you end it, it sits idle, or it reaches its time limit"
      }
    return "It costs money: the session is billed to your Expo account \(until). It can take a few minutes to start."
  }
}
