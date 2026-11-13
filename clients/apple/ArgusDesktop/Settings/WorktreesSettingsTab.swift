import ArgusCore
import ArgusUI
import SwiftUI

/// Where worktrees go, and when Argus cleans them up.
struct WorktreesSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(DesktopModel.self) private var model
  @State private var defaultWorktreeBase = ""
  @State private var cleanup: WorktreeCleanupModel?

  var body: some View {
    SettingsPage {
      SettingsGroup(
        "Location",
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

      if let cleanup {
        WorktreeCleanupSettings(model: cleanup) { field, _ in
          MacTelemetry.capture(.settingsChanged(setting: Self.settingsField(field)))
        }
      }

      SettingsError(text: host.error)
    }
    .task(id: host.loaded) {
      let model = cleanup ?? WorktreeCleanupModel(host: self.model.store)
      cleanup = model
      await model.load()
      guard let backend = self.model.backend else { return }
      defaultWorktreeBase =
        (try? await backend.request(ArgusProtocol.Commands.GetWorktreesDefaultBase.self, EmptyParams()))
        ?? ""
    }
  }

  private static func settingsField(_ field: WorktreeCleanupSettings.Field) -> SettingsField {
    switch field {
    case .enabled: .worktreeCleanupEnabled
    case .landedDays: .worktreeCleanupLandedDays
    case .idleDays: .worktreeCleanupIdleDays
    case .maxSize: .worktreeCleanupMaxSize
    }
  }
}
