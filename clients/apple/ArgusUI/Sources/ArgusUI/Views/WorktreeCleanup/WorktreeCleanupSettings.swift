import ArgusCore
import ArgusKit
import SwiftUI

/// Settings → Worktrees → Cleanup, on the Mac and the phone: the policy, then
/// the dry run it implies — what goes, what stays and why.
public struct WorktreeCleanupSettings: View {
  public enum Field: String, Sendable {
    case enabled, landedDays = "landed_days", idleDays = "idle_days", maxSize = "max_size"
  }

  let model: WorktreeCleanupModel
  let canEdit: Bool
  /// The knob that changed and its new value, for telemetry.
  let onChanged: (Field, String) -> Void

  public init(model: WorktreeCleanupModel, canEdit: Bool = true, onChanged: @escaping (Field, String) -> Void = { _, _ in }) {
    self.model = model
    self.canEdit = canEdit
    self.onChanged = onChanged
  }

  public var body: some View {
    if let policy = model.policy {
      policyGroup(policy)
      WorktreeCleanupList(model: model, canRun: canEdit)
    } else if let error = model.error {
      SettingsGroup("Cleanup") { SettingsRow("Couldn't read the cleanup policy", description: error) }
    } else {
      SettingsGroup("Cleanup") { Loading(label: "Measuring worktrees…") }
    }
  }

  private func policyGroup(_ policy: WorktreeCleanupModel.Policy) -> some View {
    SettingsGroup(
      "Cleanup",
      footer: "Sessions with uncommitted changes, commits that aren't pushed or merged, or a running agent "
        + "are always kept. Branches stay; only the worktree on disk goes."
    ) {
      SettingsToggleRow(
        "Clean up automatically",
        description: "Every few hours, remove what's listed below and note it in Notifications.",
        isOn: binding(policy, \.enabled, .enabled))
      .disabled(!canEdit)
      daysRow(
        "After merging", description: "Once a session is merged, or its pull request merged or closed.",
        policy, \.landedDays, .landedDays, options: [1, 3, 7, 14, 30])
      daysRow(
        "When untouched", description: "No commits or agent activity for this long.",
        policy, \.idleDays, .idleDays, options: [7, 14, 30, 60, 90])
      SettingsRow(
        "Disk limit",
        description: "Past this, the least recently used worktrees go first, even if they aren't stale yet."
      ) {
        Picker("Disk limit", selection: binding(policy, \.maxGb, .maxSize)) {
          Text("No limit").tag(0.0)
          ForEach(Self.withCurrent([25, 50, 100, 200, 500], policy.maxGb), id: \.self) { gb in
            Text("\(Int(gb)) GB").tag(gb)
          }
        }
        .pickerStyle(.menu)
        .disabled(!canEdit)
      }
    }
  }

  private func daysRow(
    _ title: String, description: String, _ policy: WorktreeCleanupModel.Policy,
    _ key: WritableKeyPath<WorktreeCleanupModel.Policy, Int>, _ field: Field, options: [Int]
  ) -> some View {
    SettingsRow(title, description: description) {
      Picker(title, selection: binding(policy, key, field)) {
        Text("Never").tag(0)
        ForEach(Self.withCurrent(options, policy[keyPath: key]), id: \.self) { days in
          Text(days == 1 ? "After 1 day" : "After \(days) days").tag(days)
        }
      }
      .pickerStyle(.menu)
      .disabled(!canEdit)
    }
  }

  /// Keeps a value set elsewhere selectable instead of blanking the picker.
  static func withCurrent<T: Comparable & Numeric>(_ options: [T], _ current: T) -> [T] {
    current == 0 || options.contains(current) ? options : (options + [current]).sorted()
  }

  private func binding<V: Equatable>(
    _ policy: WorktreeCleanupModel.Policy, _ key: WritableKeyPath<WorktreeCleanupModel.Policy, V>,
    _ field: Field
  ) -> Binding<V> {
    Binding(
      get: { policy[keyPath: key] },
      set: { value in
        guard value != policy[keyPath: key] else { return }
        var next = policy
        next[keyPath: key] = value
        Task {
          if await model.setPolicy(next) { onChanged(field, "\(value)") }
        }
      })
  }
}
