import ArgusCore
import ArgusMenuBar
import ArgusUI
import SwiftUI

/// This Mac's name, where Argus opens, the menu bar and login item, extra "Open in" apps, and telemetry.
struct GeneralSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(DesktopModel.self) private var model
  @State private var telemetry = TelemetryConsent.sanitize(MacTelemetry.mode)

  var body: some View {
    SettingsPage {
      DeviceNameSection()

      SettingsGroup("Startup") {
        SettingsRow("Launch screen", description: "Where Argus lands when it opens.") {
          Picker("Launch screen", selection: launchRoute) {
            Text("Home").tag(ArgusProtocol.AppSettingsLaunchRoute.home)
            Text("Inbox").tag(ArgusProtocol.AppSettingsLaunchRoute.inbox)
          }
          .pickerStyle(.segmented)
          .disabled(!host.loaded)
        }
        SettingsToggleRow(
          "Open at Login", description: "Opens Argus when you log in to this Mac.",
          isOn: Binding(
            get: { menuBar.loginState == .enabled || menuBar.loginState == .requiresApproval },
            set: { menuBar.setOpenAtLogin($0) }))
        if menuBar.loginState == .requiresApproval {
          SettingsRow("Allow Argus in Login Items", description: "macOS wants your OK before Argus opens at login.") {
            Button("Open Login Items") { LoginItem.openSystemSettings() }
          }
        }
        SettingsToggleRow(
          "Show in menu bar",
          description: "Agents that need you and what's running, pairing a device and approving a join, "
            + "from the menu bar. Off by default when Argus Server is installed, which has its own.",
          isOn: MenuBarVisibility.binding(AppPreferences.shared, via: .settings))
      }

      SettingsGroup("Notifications") {
        SettingsToggleRow(
          "Agent needs you",
          description: "A banner on this Mac when an agent asks for approval, has a question or plan for you, "
            + "or stops on an error.",
          isOn: notify(.notifyNeedsYou, get: \.notifyNeedsYou) { $0.notifyNeedsYou = $1 }
        )
        .disabled(!host.loaded)
        SettingsToggleRow(
          "Agent finished",
          description: "A banner on this Mac when an agent finishes a turn. Each phone chooses its own "
            + "under Settings → Alerts.",
          isOn: notify(.notifyFinished, get: \.notifyFinished) { $0.notifyFinished = $1 }
        )
        .disabled(!host.loaded)
        SettingsRow(
          "Usage limit warning",
          description: "Warns once per window when a plan limit reaches this much, with a switch to another "
            + "Claude account when one has room. Arrives as Agent needs you, here and on your phones."
        ) {
          Picker("Usage limit warning", selection: usageWarning) {
            Text("Off").tag(0)
            ForEach(Self.usageWarningSteps, id: \.self) { Text("\($0)%").tag($0) }
          }
          .clickable(host.loaded)
          .disabled(!host.loaded)
        }
      }

      CustomEditorsSection()

      SettingsGroup("Privacy") {
        SettingsRow("Telemetry", description: telemetryCaption) {
          Picker("Telemetry", selection: telemetryMode) {
            ForEach(TelemetryConsent.allCases, id: \.self) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
        }
      }

      SettingsError(text: host.error)
    }
    .onAppear { menuBar.refreshLoginState() }
  }

  private var menuBar: MenuBarModel { model.menuBar }

  private var launchRoute: Binding<ArgusProtocol.AppSettingsLaunchRoute> {
    Binding(
      get: { host.settings?.launchRoute ?? .home },
      set: { next in
        Task {
          await host.save(.launchRoute, ["launch_route": .string(next.rawValue)]) {
            $0.launchRoute = next
          }
        }
      })
  }

  static let usageWarningSteps = [75, 80, 85, 90, 95]

  /// Unset means 90%; 0 is off.
  private var usageWarning: Binding<Int> {
    Binding(
      get: { host.settings?.usageWarningPercent ?? 90 },
      set: { next in
        Task {
          await host.save(.usageWarningPercent, ["usage_warning_percent": .number(Double(next))]) {
            $0.usageWarningPercent = next
          }
        }
      })
  }

  /// Both categories default on, so only an explicit `false` turns one off.
  private func notify(
    _ field: SettingsField, get: KeyPath<ArgusProtocol.AppSettings, Bool?>,
    set: @escaping (inout ArgusProtocol.AppSettings, Bool) -> Void
  ) -> Binding<Bool> {
    Binding(
      get: { host.settings?[keyPath: get] != false },
      set: { next in
        Task { await host.save(field, [field.rawValue: .bool(next)]) { set(&$0, next) } }
      })
  }

  private var telemetryMode: Binding<TelemetryConsent> {
    Binding(
      get: { telemetry },
      set: { next in
        telemetry = next
        MacTelemetry.mode = next.rawValue
        Task {
          await host.run(
            ArgusProtocol.Commands.TelemetrySetMode.self,
            .init(mode: ArgusProtocol.TelemetryMode(rawValue: next.rawValue)))
          MacTelemetry.capture(.settingsChanged(setting: .telemetryMode))
        }
      })
  }

  private var telemetryCaption: String {
    let detail =
      switch telemetry {
      case .presence:
        "One anonymous heartbeat per launch — install id and app version, nothing else. Lets us "
          + "count daily active users without learning what anyone does. This is the minimum; it "
          + "can't be turned off."
      case .full:
        "Anonymous install id, app/OS info, feature usage, errors, and crashes. Never file "
          + "contents, prompts, project names, branch names, or paths."
      }
    return "Choose how much Argus shares with us. \(detail)"
  }
}
