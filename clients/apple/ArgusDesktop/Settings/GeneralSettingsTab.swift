import ArgusCore
import ArgusUI
import SwiftUI

/// Where Argus opens, where worktrees go, extra "Open in" apps, and telemetry.
struct GeneralSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(DesktopModel.self) private var model
  @State private var telemetry = TelemetryConsent.sanitize(MacTelemetry.mode)
  @State private var defaultWorktreeBase = ""

  var body: some View {
    SettingsPage {
      SettingsGroup("Startup") {
        SettingsRow("Launch screen", description: "Where Argus lands when it opens. Restored window tabs still win.") {
          Picker("Launch screen", selection: launchRoute) {
            Text("Home").tag(ArgusProtocol.AppSettingsLaunchRoute.home)
            Text("Inbox").tag(ArgusProtocol.AppSettingsLaunchRoute.inbox)
          }
          .pickerStyle(.segmented)
          .disabled(!host.loaded)
        }
      }

      SettingsGroup(
        "Worktrees",
        footer: "A project can override either of these from its own settings — that override is personal "
          + "and never written into the repository. If the automation drive isn't connected, "
          + "scheduled runs skip that project instead of falling back to your boot disk."
      ) {
        if let settings = host.settings {
          WorktreeLocationField(
            label: "Worktree location", defaultPath: defaultWorktreeBase,
            value: settings.worktreesBaseDir ?? ""
          ) { next in
            await host.save(.worktreeLocation, ["worktrees_base_dir": .string(next)]) {
              $0.worktreesBaseDir = next
            }
          }
          WorktreeLocationField(
            label: "Automation worktree location",
            caption: "Where automations create their worktrees. They open far more than anyone merges, "
              + "so a roomier drive keeps a busy automation from filling up your boot disk. Leave it "
              + "empty to use the location above.",
            defaultPath: settings.worktreesBaseDir.flatMap { $0.isEmpty ? nil : $0 }
              ?? defaultWorktreeBase,
            value: settings.automationWorktreesBaseDir ?? ""
          ) { next in
            await host.save(.automationWorktreeLocation, ["automation_worktrees_base_dir": .string(next)]) {
              $0.automationWorktreesBaseDir = next
            }
          }
        } else {
          SettingsLoading()
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
    .task(id: host.loaded) {
      guard let backend = model.backend else { return }
      defaultWorktreeBase =
        (try? await backend.request(ArgusProtocol.Commands.GetWorktreesDefaultBase.self, EmptyParams()))
        ?? ""
    }
  }

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
