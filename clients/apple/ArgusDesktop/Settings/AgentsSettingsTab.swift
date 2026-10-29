import ArgusCore
import ArgusUI
import SwiftUI

/// Defaults for new agents, and how far automations may go on their own.
struct AgentsSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var prefs = AppPreferences.shared

  private static let autonomyLevels: [(ArgusProtocol.AutonomyLevel?, String, String)] = [
    (nil, "No cap", ""),
    (.propose, "Propose", "Put it in the inbox and touch nothing."),
    (.draft, "Draft", "Open a worktree, implement it, commit — then stop."),
    (.pr, "Pull request", "Also push the branch and open a draft pull request."),
    (.autoMerge, "Auto-merge", "Also merge it once CI is green. Opt-in only."),
  ]

  var body: some View {
    SettingsPage {
      SettingsGroup(
        "Agents", footer: "Defaults applied when starting a new agent. Both can be overridden per session."
      ) {
        SettingsRow("Default model", description: "Pre-selected in the launcher and new-session dialog.") {
          Picker("Default model", selection: $prefs.defaultModel.tracked(.defaultModel)) {
            Text("Use Claude CLI default").tag("")
            ForEach(knownModels, id: \.value) { Text($0.displayName).tag($0.value) }
            if !prefs.defaultModel.isEmpty, !knownModels.contains(where: { $0.value == prefs.defaultModel }) {
              Text(prefs.defaultModel).tag(prefs.defaultModel)
            }
          }
        }
        SettingsRow("Default permission mode", description: "The mode new agents start in.") {
          Picker("Default permission mode", selection: $prefs.defaultPermissionMode.tracked(.permissionMode)) {
            ForEach(DefaultPermissionMode.allCases, id: \.self) { Text($0.label).tag($0) }
          }
        }
      }

      Section("Follow-up suggestions") {
        if let settings = host.settings {
          VStack(alignment: .leading, spacing: 4) {
            Toggle("Suggest replies", isOn: followUpSuggestions(settings))
            SettingsCaption(
              "When an agent finishes, a small model reads its last message and suggests replies "
                + "you can pick in the chat input.")
          }
        } else {
          SettingsLoading()
        }
      }

      Section("Warm agents") {
        if let settings = host.settings {
          VStack(alignment: .leading, spacing: 4) {
            Picker("Warm agents", selection: warmAgents(settings)) {
              Text("Off").tag(0)
              Text("1").tag(1)
              Text("2").tag(2)
            }
            .pickerStyle(.segmented)
            .fixedSize()
            SettingsCaption(
              "Agents kept started for the sessions you're looking at, so a new one is ready at once. "
                + "Each is a running Claude Code process with its MCP servers.")
          }
        } else {
          SettingsLoading()
        }
      }

      ImportCliChatsSection()

      SettingsGroup("Automations") {
        if let settings = host.settings {
          SettingsToggleRow(
            "Run automations on their schedule",
            description: "Let automations start agents on their schedule. Running one by hand always works.",
            isOn: automationsEnabled(settings))
          SettingsRow("Default autonomy", description: autonomyCaption(settings.defaultAutonomy)) {
            Picker("Default autonomy", selection: autonomy(settings)) {
              ForEach(Self.autonomyLevels, id: \.1) { level, label, _ in Text(label).tag(level) }
            }
          }
          NumberSetting(
            label: "Concurrent automation sessions",
            caption: "How many sessions automations may have running at once, across all of them. "
              + "Further proposals wait in the inbox.",
            value: Int(settings.maxConcurrentAutomationSessions ?? 3), minimum: 1
          ) { next in
            await host.save(.concurrency, ["max_concurrent_automation_sessions": .number(Double(next))]) {
              $0.maxConcurrentAutomationSessions = Double(next)
            }
          }
          NumberSetting(
            label: "Daily automation budget (USD)",
            caption: "Spend automations may reach in a day, in USD. 0 means no budget.",
            value: Int(settings.automationDailyBudgetUsd ?? 0), minimum: 0
          ) { next in
            await host.save(.dailyBudget, ["automation_daily_budget_usd": .number(Double(next))]) {
              $0.automationDailyBudgetUsd = Double(next)
            }
          }
        } else {
          SettingsLoading()
        }
      }

      AutomationAllowlistSection()

      SettingsError(text: host.error)
    }
  }

  /// What the default runner advertises; the desktop's list is whatever an
  /// agent last reported, which a fresh Mac app hasn't seen.
  private var knownModels: [ArgusProtocol.RunnerModelOption] {
    let runnerId = host.settings?.defaultLlm?.runner ?? "claude-code"
    return host.runners.first { $0.id == runnerId }?.models ?? []
  }

  private func automationsEnabled(_ settings: ArgusProtocol.AppSettings) -> Binding<Bool> {
    Binding(
      get: { settings.automationsEnabled != false },
      set: { next in
        Task {
          await host.save(.automationsEnabled, ["automations_enabled": .bool(next)]) {
            $0.automationsEnabled = next
          }
        }
      })
  }

  private func followUpSuggestions(_ settings: ArgusProtocol.AppSettings) -> Binding<Bool> {
    Binding(
      get: { settings.followUpSuggestions != false },
      set: { next in
        Task {
          await host.save(.followUpSuggestions, ["follow_up_suggestions": .bool(next)]) {
            $0.followUpSuggestions = next
          }
        }
      })
  }

  private func warmAgents(_ settings: ArgusProtocol.AppSettings) -> Binding<Int> {
    Binding(
      get: { settings.warmAgents ?? 1 },
      set: { next in
        Task {
          await host.save(.warmAgents, ["warm_agents": .number(Double(next))]) {
            $0.warmAgents = next
          }
        }
      })
  }

  private func autonomy(_ settings: ArgusProtocol.AppSettings) -> Binding<ArgusProtocol.AutonomyLevel?> {
    Binding(
      get: { settings.defaultAutonomy },
      set: { next in
        Task {
          await host.save(.defaultAutonomy, ["default_autonomy": next.map { .string($0.rawValue) } ?? .null]) {
            $0.defaultAutonomy = next
          }
        }
      })
  }

  private func autonomyCaption(_ level: ArgusProtocol.AutonomyLevel?) -> String {
    guard let level, let caption = Self.autonomyLevels.first(where: { $0.0 == level })?.2 else {
      return "Every automation runs at the level it sets for itself. A project can still cap it lower."
    }
    return "\(caption) Caps every automation, and applies to those that don't set their own level. "
      + "A project can cap it lower, never higher."
  }
}

/// A whole-number host setting, saved when you commit the field.
private struct NumberSetting: View {
  let label: String
  let caption: String
  let value: Int
  let minimum: Int
  let save: (Int) async -> Void
  @State private var draft = 0

  var body: some View {
    SettingsRow(label, description: caption) {
      HStack(spacing: 6) {
        TextField(label, value: $draft, format: .number)
          .multilineTextAlignment(.trailing)
          .textFieldStyle(.roundedBorder)
          .frame(width: 72)
          .onSubmit(commit)
        Stepper(label, value: $draft, in: minimum...Int.max, onEditingChanged: { editing in
          if !editing { commit() }
        })
        .labelsHidden()
      }
    }
    .onAppear { draft = value }
    .onChange(of: value) { _, next in draft = next }
  }

  private func commit() {
    draft = max(minimum, draft)
    guard draft != value else { return }
    let next = draft
    Task { await save(next) }
  }
}
