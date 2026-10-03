import ArgusUI
import Foundation
import SwiftUI

/// Argus's per-project git preferences: branch prefix, LFS banners and
/// archived branches are personal (`user-project-settings.json`); auto-fetch
/// is shared through `.argus.json`.
struct GitArgusSettingsSection: View {
  @Environment(HostStore.self) private var store
  let workspace: GitWorkspace

  @State private var settings: ArgusProtocol.UserProjectSettings?
  @State private var autoFetch = AutoFetch.off
  @State private var prefixDraft = ""
  @State private var error: String?

  enum AutoFetch: Int, CaseIterable, Identifiable {
    case off = 0, five = 5, fifteen = 15, hour = 60
    var id: Int { rawValue }
    var title: String { self == .off ? "Off" : "\(rawValue) min" }

    init(minutes: Double?) {
      let m = Int(minutes ?? 0)
      self = m <= 0 ? .off : m <= 5 ? .five : m <= 15 ? .fifteen : .hour
    }
  }

  var body: some View {
    Section {
      LabeledContent("Branch prefix") {
        HStack {
          TextField("Branch prefix", text: $prefixDraft, prompt: Text("e.g. you/"))
            .labelsHidden()
            .onSubmit(savePrefix)
          Button("Save", action: savePrefix).disabled(prefixDraft == (settings?.branchPrefix ?? ""))
        }
      }
      Picker("Auto-fetch", selection: autoFetchBinding) {
        ForEach(AutoFetch.allCases) { Text($0.title).tag($0) }
      }
      .disabled(store.backend?.kind != .local)
      Toggle("Hide LFS banners", isOn: suppressLfs)
      archived
    } header: {
      Text("Argus")
    } footer: {
      Text(error ?? "Auto-fetch runs git fetch --prune in the background and is shared through .argus.json; the rest stays on this Mac.")
        .foregroundStyle(.secondary)
    }
    .task { await load() }
  }

  @ViewBuilder
  private var archived: some View {
    let branches = settings?.archivedBranches ?? []
    if branches.isEmpty {
      LabeledContent("Archived branches", value: "None")
    } else {
      DisclosureGroup("Archived branches (\(branches.count))") {
        ForEach(branches, id: \.self) { branch in
          HStack {
            Text(branch).font(.system(size: 12, design: .monospaced))
            Spacer()
            Button("Unarchive") { unarchive(branch) }.controlSize(.small)
          }
        }
      }
    }
  }

  private var repoRoot: String { workspace.repoRoot }

  private var suppressLfs: Binding<Bool> {
    Binding(
      get: { settings?.suppressLfsWarning == true },
      set: { value in save(.init(suppressLfsWarning: value)) })
  }

  private var autoFetchBinding: Binding<AutoFetch> {
    Binding(get: { autoFetch }, set: { saveAutoFetch($0) })
  }

  private func load() async {
    switch await GitToolRead.request(
      store, ArgusProtocol.Commands.GetUserProjectSettings.self, .init(repoRoot: repoRoot))
    {
    case .success(let next):
      settings = next
      prefixDraft = next.branchPrefix ?? ""
    case .failure(let failure):
      error = failure.message
    }
    if case .success(let config) = await GitToolRead.request(
      store, ArgusProtocol.Commands.ReadArgusConfig.self, .init(repoRoot: repoRoot))
    {
      autoFetch = AutoFetch(minutes: config.autoFetchMinutes)
    }
  }

  private func savePrefix() {
    save(.init(branchPrefix: prefixDraft.trimmingCharacters(in: .whitespaces)))
  }

  private func save(_ patch: ArgusProtocol.UserProjectSettings) {
    Task {
      switch await GitToolRead.request(
        store, ArgusProtocol.Commands.SetUserProjectSettings.self, .init(repoRoot: repoRoot, settings: patch))
      {
      case .success(let next):
        settings = next
        prefixDraft = next.branchPrefix ?? ""
        error = nil
        workspace.track(.config, success: true)
      case .failure(let failure):
        error = failure.message
        workspace.track(.config, success: false)
      }
    }
  }

  private func unarchive(_ branch: String) {
    Task {
      let left = await workspace.host(
        ArgusProtocol.Commands.GitUnarchiveBranch.self, .init(repoRoot: repoRoot, branch: branch),
        label: "Unarchiving \(branch)")
      if let left { settings?.archivedBranches = left }
    }
  }

  /// `.argus.json` is rewritten with only `auto_fetch_minutes` changed, so
  /// keys this build doesn't model survive. The host shares this disk.
  private func saveAutoFetch(_ next: AutoFetch) {
    let previous = autoFetch
    autoFetch = next
    Task {
      let path = (repoRoot as NSString).appendingPathComponent(".argus.json")
      var json: [String: Any] = [:]
      if let data = FileManager.default.contents(atPath: path) {
        guard let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
          autoFetch = previous
          error = ".argus.json isn't valid JSON; fix it before changing auto-fetch."
          return
        }
        json = parsed
      }
      json["auto_fetch_minutes"] = next == .off ? nil : next.rawValue
      guard
        let data = try? JSONSerialization.data(
          withJSONObject: json, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]),
        let content = String(data: data, encoding: .utf8)
      else { return }
      let minutes: Double? = next == .off ? nil : Double(next.rawValue)
      let wrote = await workspace.host(
        ArgusProtocol.Commands.WriteArgusConfig.self, .init(repoRoot: repoRoot, content: content + "\n"),
        label: "Saving auto-fetch")
      guard wrote != nil else { return autoFetch = previous }
      await workspace.host(
        ArgusProtocol.Commands.GitReconfigureAutoFetch.self, .init(repoRoot: repoRoot, minutes: minutes),
        label: "Saving auto-fetch", track: .config)
    }
  }
}
