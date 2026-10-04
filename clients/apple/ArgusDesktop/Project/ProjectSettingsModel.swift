import ArgusCore
import ArgusKit
import Foundation
import Observation

/// One project's settings while the sheet is open: the `.argus.json` draft
/// over the raw file it came from, and the personal settings kept in
/// `~/.argus/user-project-settings.json`.
@MainActor
@Observable
final class ProjectSettingsModel {
  let repoRoot: String
  var draft = ArgusConfigDraft()
  private(set) var initial = ArgusConfigDraft()
  private(set) var raw: [String: JSONValue] = [:]
  private(set) var loaded = false
  private(set) var saving = false
  var error: String?

  // Personal
  var branchPrefix = ""
  private(set) var initialBranchPrefix = ""
  private(set) var worktreeBase = ""
  private(set) var automationWorktreeBase = ""
  private(set) var worktreeDefault = ""
  private(set) var automationWorktreeDefault = ""

  init(repoRoot: String) {
    self.repoRoot = repoRoot
  }

  var output: [String: JSONValue] { draft.applied(to: raw) }
  var previewJSON: String { ConfigJSON.string(.object(output)) }
  var isDirty: Bool { draft != initial || branchPrefix.trimmingCharacters(in: .whitespaces) != initialBranchPrefix }

  func load(_ backend: HostRouter) async {
    // The raw file, not the host's normalized config, so unknown keys survive.
    let found = try? await backend.request(
      ArgusProtocol.Commands.OnboardingReadExistingArgusJson.self, .init(path: repoRoot))
    raw = (found ?? nil) ?? [:]
    draft = ArgusConfigDraft(raw: raw)
    initial = draft
    if let personal = try? await backend.request(
      ArgusProtocol.Commands.GetUserProjectSettings.self, .init(repoRoot: repoRoot))
    {
      branchPrefix = personal.branchPrefix ?? ""
      initialBranchPrefix = branchPrefix
      worktreeBase = personal.worktreesBaseDir ?? ""
      automationWorktreeBase = personal.automationWorktreesBaseDir ?? ""
    }
    await loadStorage(backend)
    loaded = true
  }

  private func loadStorage(_ backend: HostRouter) async {
    guard let storage = try? await backend.request(
      ArgusProtocol.Commands.GetWorktreeStorage.self, .init(repoRoot: repoRoot))
    else { return }
    worktreeDefault = storage.appBase ?? storage.defaultBase
    // What the automation field inherits: the app-wide automation base if
    // set, otherwise this project's own worktree location.
    automationWorktreeDefault = storage.automationAppBase ?? storage.root
  }

  /// Writes `.argus.json` and the branch prefix; true when the sheet can close.
  func save(_ backend: HostRouter) async -> Bool {
    guard draft.isValid else {
      error = draft.validationErrors.joined(separator: "\n")
      return false
    }
    saving = true
    error = nil
    defer { saving = false }
    let out = output
    let changed = Set(raw.keys).union(out.keys).filter { raw[$0] != out[$0] }.count
    let prefix = branchPrefix.trimmingCharacters(in: .whitespaces)
    let personal = prefix != initialBranchPrefix
    do {
      try await backend.request(
        ArgusProtocol.Commands.WriteArgusConfig.self,
        .init(repoRoot: repoRoot, content: ConfigJSON.string(.object(out)) + "\n"))
      if draft.autoFetchMinutes != initial.autoFetchMinutes {
        // Re-arms the fetch timer for open sessions now, not on next launch.
        try await backend.request(
          ArgusProtocol.Commands.GitReconfigureAutoFetch.self,
          .init(repoRoot: repoRoot, minutes: draft.autoFetchMinutes > 0 ? Double(draft.autoFetchMinutes) : nil))
      }
      if personal {
        _ = try await backend.request(
          ArgusProtocol.Commands.SetUserProjectSettings.self,
          .init(repoRoot: repoRoot, settings: .init(branchPrefix: prefix)))
      }
      MacTelemetry.capture(
        .projectSettingsSaved(changed: MacTelemetryEvent.countBucket(changed), personal: personal, success: true))
      return true
    } catch {
      MacTelemetry.capture(
        .projectSettingsSaved(changed: MacTelemetryEvent.countBucket(changed), personal: personal, success: false))
      self.error = HostStore.describe(error)
      return false
    }
  }

  /// Saved straight away, as the desktop does: it's personal, not part of the file.
  func commitWorktreeBase(_ value: String, purpose: ArgusProtocol.WorktreePurpose, _ backend: HostRouter) async {
    let settings =
      purpose == .automation
      ? ArgusProtocol.UserProjectSettings(automationWorktreesBaseDir: value)
      : ArgusProtocol.UserProjectSettings(worktreesBaseDir: value)
    do {
      _ = try await backend.request(
        ArgusProtocol.Commands.SetUserProjectSettings.self, .init(repoRoot: repoRoot, settings: settings))
      if purpose == .automation { automationWorktreeBase = value } else { worktreeBase = value }
      await loadStorage(backend)
    } catch {
      self.error = HostStore.describe(error)
    }
  }
}
