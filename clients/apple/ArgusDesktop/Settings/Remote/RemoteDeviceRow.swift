import ArgusCore
import ArgusUI
import SwiftUI

/// One paired device: label, last seen or connected, grants, push channel,
/// Control/Admin toggles, a test push and Revoke.
struct RemoteDeviceRow: View {
  @Environment(\.theme) private var theme
  let model: RemoteSettingsModel
  let device: ArgusProtocol.PairedDevice
  let connected: Bool
  @State private var sendingPush = false

  private var hasAdmin: Bool { device.capabilities.contains(.admin) }
  private var hasControl: Bool { device.capabilities.contains(.control) }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(device.label).fontWeight(.medium)
          meta
        }
        Spacer()
        // No destructive role: inside a grouped Form row it stops taking clicks.
        Button("Revoke…") { model.revoking = device }
          .foregroundStyle(theme.error)
          .disabled(model.busy)
      }
      HStack(spacing: 16) {
        Toggle("Control", isOn: grant(admin: false))
          .disabled(model.busy || hasAdmin)
        Toggle("Admin", isOn: grant(admin: true))
          .disabled(model.busy)
          .help("Let this Mac drive Argus here as if sitting at the keyboard. Only for another Mac you own.")
        Spacer()
        if device.push != nil {
          if let result = model.pushResults[device.deviceId] {
            Text(result).font(.caption).foregroundStyle(theme.textSecondary)
          }
          Button("Test Push") {
            sendingPush = true
            Task {
              await model.testPush(deviceId: device.deviceId)
              sendingPush = false
            }
          }
          .disabled(sendingPush)
        }
      }
      .toggleStyle(.checkbox)
    }
    .padding(.vertical, 2)
  }

  private var meta: some View {
    HStack(spacing: 6) {
      if connected {
        StatusDot(tone: .success, pulse: true)
        Text("connected")
      } else {
        Text(RemoteAccessLabels.lastSeen(device.lastSeen))
      }
      Text("·")
      Text(RemoteAccessLabels.grants(device.capabilities))
      if let kind = RemoteAccessLabels.clientKind(device) {
        Text("·")
        Text(kind)
      }
      if let push = device.push {
        Text("·")
        Text("push via \(RemoteAccessLabels.push(push.service))")
      }
    }
    .font(.caption)
    .foregroundStyle(theme.textSecondary)
  }

  /// Admin implies control; dropping admin keeps control as it was.
  private func grant(admin: Bool) -> Binding<Bool> {
    Binding(
      get: { admin ? hasAdmin : (hasControl || hasAdmin) },
      set: { next in
        Task {
          if admin {
            await model.setGrants(deviceId: device.deviceId, control: hasControl || next, admin: next)
          } else {
            await model.setGrants(deviceId: device.deviceId, control: next, admin: hasAdmin)
          }
        }
      })
  }
}
