import ArgusUI
import SwiftUI

/// Which device `/devices/:platform/:deviceKey` names.
struct DeviceRef: Hashable, Sendable {
  let platform: String
  let deviceKey: String

  init(platform: String, deviceKey: String) {
    self.platform = platform
    self.deviceKey = deviceKey
  }

  init(_ device: ArgusProtocol.DeviceInfo) {
    self.init(platform: device.platform.rawValue, deviceKey: device.deviceKey)
  }

  func matches(_ device: ArgusProtocol.DeviceInfo) -> Bool {
    device.platform.rawValue == platform && device.deviceKey == deviceKey
  }
}

/// One device in full: who holds it, a live picture, and its power and
/// popout actions — the renderer's `DeviceDialog`.
struct DeviceDetailSheet: View {
  @Environment(\.theme) private var theme
  let device: ArgusProtocol.DeviceInfo
  let busy: Bool
  let onBoot: () -> Void
  let onShutdown: () -> Void
  let onPopout: () -> Void
  let onOpen: (_ agent: Bool) -> Void
  let onOpenProject: () -> Void
  let onClose: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(device.name).font(.system(size: 15, weight: .semibold))
        Text("\(device.platform.rawValue) · \(device.online ? "online" : "offline")")
          .font(.system(size: 12))
          .foregroundStyle(theme.textMuted)
        Spacer()
      }
      .padding(16)
      Divider()
      HStack(alignment: .top, spacing: 16) {
        metadata.frame(width: 260, alignment: .topLeading)
        preview.frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .padding(16)
      Divider()
      actions.padding(12)
    }
    .frame(minWidth: 720, idealWidth: 860, minHeight: 560, idealHeight: 680)
  }

  private var metadata: some View {
    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 8) {
      row("Key") { Text(device.deviceKey).textSelection(.enabled) }
      if let runtime = device.runtime, !runtime.isEmpty {
        row("Runtime") { Text(runtime) }
      }
      row("Agent") { link(device.agentId) { onOpen(true) } }
      row("Session") { link(device.sessionId) { onOpen(false) } }
      row("Project") {
        link(device.repoRoot.map { ($0 as NSString).lastPathComponent }, run: onOpenProject)
      }
    }
    .font(.system(size: 12))
  }

  private func row(_ label: String, @ViewBuilder value: () -> some View) -> some View {
    GridRow {
      Text(label).foregroundStyle(theme.textMuted)
      value().lineLimit(2).truncationMode(.middle)
    }
  }

  private func link(_ label: String?, run: @escaping () -> Void) -> some View {
    Group {
      if let label {
        Button(label, action: run).buttonStyle(.link)
      } else {
        Text("—").foregroundStyle(theme.textMuted)
      }
    }
  }

  @ViewBuilder private var preview: some View {
    if device.online, device.platform == .ios || device.platform == .android {
      RuntimeDeviceView(
        deviceId: device.deviceKey, platform: device.platform == .android ? .android : .ios,
        isTv: device.runtime?.hasPrefix("tvOS") ?? false)
        .clipShape(.rect(cornerRadius: theme.radiusSmall))
    } else {
      Text(device.online ? "No preview for this device." : "Boot the device to see it here.")
        .font(.system(size: 12))
        .foregroundStyle(theme.textMuted)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.bgSecondary, in: .rect(cornerRadius: theme.radiusSmall))
    }
  }

  private var actions: some View {
    HStack(spacing: 8) {
      if device.platform == .ios, !device.online {
        Button(busy ? "Booting…" : "Boot", systemImage: "power.circle", action: onBoot)
          .disabled(busy)
      }
      if device.platform == .ios, device.online {
        Button(busy ? "Shutting down…" : "Shut Down", systemImage: "stop.circle", role: .destructive, action: onShutdown)
          .disabled(busy)
      }
      // The browser lives in the main window and can't be detached.
      if device.platform != .web {
        Button("Open Floating Window", systemImage: "rectangle.portrait.on.rectangle.portrait", action: onPopout)
      }
      Spacer()
      Button("Close", action: onClose).keyboardShortcut(.cancelAction)
    }
  }
}
