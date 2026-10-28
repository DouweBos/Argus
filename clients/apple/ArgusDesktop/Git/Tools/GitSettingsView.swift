import ArgusUI
import GroveKit
import SwiftUI

/// The project's git settings: repo-local config, remotes, and Argus's own
/// per-project git preferences (Electron's `ProjectGitSettingsView`).
struct GitSettingsView: View {
  let workspace: GitWorkspace

  var body: some View {
    Form {
      GitConfigSection(workspace: workspace)
      GitSigningSection(sessionId: workspace.sessionId, workspace: workspace)
      GitRemotesSection(workspace: workspace)
      GitArgusSettingsSection(workspace: workspace)
      GitLfsSection(workspace: workspace)
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
  }
}

/// Repo-local `git config` (`--local`); an empty field unsets the key, so the
/// global value applies again.
private struct GitConfigSection: View {
  @Environment(HostStore.self) private var store
  let workspace: GitWorkspace

  @State private var saved: [String: String] = [:]
  @State private var draft: [String: String] = [:]
  @State private var loadError: String?
  @State private var saving = false

  private static let keys = ["user.name", "user.email", "pull.rebase", "pull.ff", "fetch.prune", "push.autoSetupRemote"]

  var body: some View {
    Section {
      TextField("Name", text: binding("user.name"), prompt: Text("Inherited from global config"))
      TextField("Email", text: binding("user.email"), prompt: Text("Inherited from global config"))
      Picker("Pull strategy", selection: pullStrategy) {
        ForEach(PullChoice.allCases) { Text($0.title).tag($0) }
      }
      Toggle("Prune on fetch", isOn: flag("fetch.prune"))
      Toggle("Set upstream on first push", isOn: flag("push.autoSetupRemote"))
    } header: {
      Text("Repository config")
    } footer: {
      HStack {
        Text(loadError ?? "Written to this repository's .git/config only.")
          .foregroundStyle(.secondary)
        Spacer()
        Button("Revert") { draft = saved }.disabled(!dirty || saving)
        Button("Save") { save() }.disabled(!dirty || saving)
      }
    }
    .task { await load() }
  }

  private var dirty: Bool { draft != saved }

  private func binding(_ key: String) -> Binding<String> {
    Binding(get: { draft[key] ?? "" }, set: { draft[key] = $0 })
  }

  private func flag(_ key: String) -> Binding<Bool> {
    Binding(get: { draft[key] == "true" }, set: { draft[key] = $0 ? "true" : "" })
  }

  /// `pull.rebase` and `pull.ff` together, as `git pull` reads them.
  enum PullChoice: String, CaseIterable, Identifiable {
    case inherit, merge, rebase, fastForwardOnly
    var id: String { rawValue }
    var title: String {
      switch self {
      case .inherit: "Git default"
      case .merge: "Merge"
      case .rebase: "Rebase"
      case .fastForwardOnly: "Fast-forward only"
      }
    }
  }

  private var pullStrategy: Binding<PullChoice> {
    Binding(
      get: {
        if draft["pull.ff"] == "only" { return .fastForwardOnly }
        switch draft["pull.rebase"] {
        case "true": return .rebase
        case "false": return .merge
        default: return .inherit
        }
      },
      set: { choice in
        draft["pull.ff"] = choice == .fastForwardOnly ? "only" : ""
        draft["pull.rebase"] =
          switch choice {
          case .rebase: "true"
          case .merge: "false"
          default: ""
          }
      })
  }

  private func load() async {
    var values: [String: String] = [:]
    for key in Self.keys {
      switch await GitToolRead.request(
        store, ArgusProtocol.Commands.GitGetConfig.self, .init(id: workspace.sessionId, key: key))
      {
      case .success(let value): values[key] = value ?? ""
      case .failure(let error): loadError = error.message
      }
    }
    saved = values
    draft = values
  }

  private func save() {
    let changes = Self.keys.filter { (draft[$0] ?? "") != (saved[$0] ?? "") }
    saving = true
    Task {
      for key in changes {
        let value = (draft[key] ?? "").trimmingCharacters(in: .whitespaces)
        await workspace.host(
          ArgusProtocol.Commands.GitSetConfig.self, .init(id: workspace.sessionId, key: key, value: value),
          label: "Saving \(key)", track: .config)
      }
      saving = false
      await load()
    }
  }
}

/// Git LFS: whether it's installed and what the repository tracks with it.
private struct GitLfsSection: View {
  @Environment(HostStore.self) private var store
  let workspace: GitWorkspace
  @State private var lfs: ArgusProtocol.LfsFiles?

  var body: some View {
    Group {
      if let lfs, lfs.repoUsesLfs || !lfs.lfsInstalled {
        Section("Git LFS") {
          LabeledContent("git-lfs", value: lfs.lfsInstalled ? "Installed" : "Not installed")
          LabeledContent("Tracked files", value: "\(lfs.tracked.count)")
          if !lfs.tracked.isEmpty {
            DisclosureGroup("Show tracked files") {
              ForEach(lfs.tracked.prefix(200), id: \.self) { path in
                Text(path).font(.scaled(size: 11, design: .monospaced)).lineLimit(1).truncationMode(.middle)
              }
            }
          }
        }
      }
    }
    .task {
      if case .success(let files) = await GitToolRead.request(
        store, ArgusProtocol.Commands.GitLfsFiles.self, .init(id: workspace.sessionId))
      {
        lfs = files
      }
    }
  }
}
