import ArgusCore
import Foundation

/// What the Settings window changes, each through the host command the
/// desktop's Settings uses.
extension ServerModel {
  func setTelemetry(_ consent: TelemetryConsent) async {
    ServerTelemetry.mode = consent
    guard let backend else { return }
    _ = try? await backend.request(
      ArgusProtocol.Commands.TelemetrySetMode.self, .init(mode: ArgusProtocol.TelemetryMode(rawValue: consent.rawValue)))
  }

  func setAccountConfig(_ patch: ArgusProtocol.AccountConfigPatch) async {
    guard let backend else { return }
    do {
      account = try await backend.request(ArgusProtocol.Commands.AccountSetConfig.self, .init(patch: patch))
      notice = nil
    } catch {
      notice = HostStore.describe(error)
    }
  }

  func renameComputer(_ name: String) async {
    guard let backend else { return }
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      account = try await backend.request(
        ArgusProtocol.Commands.AccountSetName.self, .init(name: trimmed.isEmpty ? nil : trimmed))
      ServerTelemetry.capture(.menuAction(action: .rename))
    } catch {
      notice = HostStore.describe(error)
    }
  }

  func setDeviceGrant(_ deviceId: String, _ grant: ArgusProtocol.AccountGrantSetting) async {
    guard let backend else { return }
    do {
      _ = try await backend.request(
        ArgusProtocol.Commands.RemoteSetDeviceControl.self,
        .init(deviceId: deviceId, control: grant != .monitor, admin: grant == .admin))
      await refreshRemote()
    } catch {
      notice = HostStore.describe(error)
    }
  }

  func revokeDevice(_ deviceId: String) async {
    guard let backend else { return }
    do {
      _ = try await backend.request(ArgusProtocol.Commands.RemoteRevokeDevice.self, .init(deviceId: deviceId))
      await refreshRemote()
    } catch {
      notice = HostStore.describe(error)
    }
  }
}
