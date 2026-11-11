import ArgusCore
import ArgusKit
import Foundation
import Observation

/// One project's settings while the sheet is open: the config draft over the
/// effective config it came from (a checked-in `.argus.json` with this Mac's
/// layer over it), and the personal settings kept on this Mac.
@MainActor
@Observable
final class ProjectSettingsModel {
  let repoRoot: String
  var draft = ArgusConfigDraft()
  private(set) var initial = ArgusConfigDraft()
  private(set) var raw: [String: JSONValue] = [:]
  /// Whether the repo has a checked-in `.argus.json`, and which top-level keys
  /// it and this Mac set.
  private(set) var repoFile = false
  private(set) var repoKeys: Set<String> = []
  private(set) var hostKeys: Set<String> = []
  private(set) var transferring = false
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
    do {
      apply(try await backend.request(ArgusProtocol.Commands.GetProjectConfig.self, .init(repoRoot: repoRoot)))
    } catch {
      self.error = HostStore.describe(error)
    }
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

  /// Where a section's keys come from.
  func source(of keys: [String]) -> ConfigSource {
    guard repoFile else { return .mac }
    let fromRepo = !repoKeys.isDisjoint(with: keys)
    let onMac = !hostKeys.isDisjoint(with: keys)
    switch (fromRepo, onMac) {
    case (true, true): return .overridden
    case (true, false): return .repo
    case (false, true): return .mac
    case (false, false): return .unset
    }
  }

  private func apply(_ project: ArgusProtocol.ProjectConfig) {
    raw = project.config
    repoFile = project.repoFile
    repoKeys = Set(project.repoKeys)
    hostKeys = Set(project.hostKeys)
    draft = ArgusConfigDraft(raw: raw)
    initial = draft
  }

  /// The saved config as `.argus.json` text, for Export….
  func exportText(_ backend: HostRouter) async -> String? {
    transferring = true
    defer { transferring = false }
    do {
      return try await backend.request(ArgusProtocol.Commands.ExportProjectConfig.self, .init(repoRoot: repoRoot))
    } catch {
      self.error = HostStore.describe(error)
      return nil
    }
  }

  /// Replaces this Mac's config with an `.argus.json` file's contents; unsaved edits are dropped.
  func importConfig(_ content: String, _ backend: HostRouter) async {
    transferring = true
    error = nil
    defer { transferring = false }
    do {
      apply(
        try await backend.request(
          ArgusProtocol.Commands.ImportProjectConfig.self, .init(repoRoot: repoRoot, content: content)))
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  /// Saves the config on this Mac and the branch prefix; true when the sheet can close.
  func save(_ backend: HostRouter) async -> Bool {
    saving = true
    error = nil
    defer { saving = false }
    let out = output
    let autoFetchChanged = draft.autoFetchMinutes != initial.autoFetchMinutes
    let changed = Set(raw.keys).union(out.keys).filter { raw[$0] != out[$0] }.count
    let prefix = branchPrefix.trimmingCharacters(in: .whitespaces)
    let personal = prefix != initialBranchPrefix
    do {
      apply(
        try await backend.request(
          ArgusProtocol.Commands.SaveProjectConfig.self, .init(repoRoot: repoRoot, config: out)))
      if autoFetchChanged {
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

/// Where a Project Settings section's values come from.
enum ConfigSource: Equatable {
  /// The checked-in `.argus.json`.
  case repo
  /// This Mac, over the checked-in `.argus.json`.
  case overridden
  /// This Mac only.
  case mac
  /// Nowhere yet.
  case unset
}

#if DEBUG
  extension ProjectSettingsModel {
    /// A loaded sheet without a host, for the gallery.
    func galleryFill(_ project: ArgusProtocol.ProjectConfig, branchPrefix: String = "") {
      apply(project)
      self.branchPrefix = branchPrefix
      initialBranchPrefix = branchPrefix
      loaded = true
    }
  }
#endif
