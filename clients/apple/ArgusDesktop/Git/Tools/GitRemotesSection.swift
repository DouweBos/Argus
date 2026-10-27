import ArgusUI
import SwiftUI

/// The repository's remotes: add, rename, change URLs, remove.
struct GitRemotesSection: View {
  @Environment(HostStore.self) private var store
  let workspace: GitWorkspace

  @State private var remotes: [ArgusProtocol.GitRemoteRich] = []
  @State private var loadError: String?
  @State private var editing: RemoteEdit?
  @State private var removing: String?

  var body: some View {
    Section {
      if remotes.isEmpty {
        Text(loadError ?? "No remotes.").foregroundStyle(.secondary)
      }
      ForEach(remotes, id: \.name) { remote in
        RemoteRow(remote: remote) { action in
          switch action {
          case .rename: editing = .rename(remote.name)
          case .setURL: editing = .setURL(remote.name, fetch: remote.fetchUrl, push: remote.pushUrl)
          case .remove: removing = remote.name
          case .copyURL: Clipboard.copy(remote.fetchUrl)
          }
        }
      }
    } header: {
      HStack {
        Text("Remotes")
        Spacer()
        Button {
          editing = .add
        } label: {
          Label("Add Remote", systemImage: "plus")
        }
        .buttonStyle(.argusBorderless)
        .controlSize(.small)
      }
    }
    .task(id: workspace.generation) { await load() }
    .sheet(item: $editing) { edit in
      RemoteEditSheet(edit: edit, existing: remotes.map(\.name)) { apply(edit, $0) }
    }
    .confirmationDialog("Remove remote “\(removing ?? "")”?", isPresented: removingShown, presenting: removing) { name in
      Button("Remove", role: .destructive) {
        run("Removing \(name)", ArgusProtocol.Commands.GitRemoveRemote.self, .init(id: id, name: name))
      }
    } message: { _ in
      Text("Its remote-tracking branches are deleted too. The remote repository itself is untouched.")
    }
  }

  private var id: String { workspace.sessionId }

  private var removingShown: Binding<Bool> {
    Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
  }

  private func apply(_ edit: RemoteEdit, _ values: RemoteEditSheet.Values) {
    switch edit {
    case .add:
      run("Adding \(values.name)", ArgusProtocol.Commands.GitAddRemote.self, .init(id: id, name: values.name, url: values.url))
    case .rename(let from):
      run("Renaming \(from)", ArgusProtocol.Commands.GitRenameRemote.self, .init(id: id, from: from, to: values.name))
    case .setURL(let name, let fetch, let push):
      Task {
        if values.url != fetch {
          await workspace.host(
            ArgusProtocol.Commands.GitSetRemoteUrl.self, .init(id: id, name: name, url: values.url),
            label: "Setting \(name)'s URL", track: .remote)
        }
        let pushURL = values.pushURL.trimmingCharacters(in: .whitespaces)
        if !pushURL.isEmpty, pushURL != push {
          await workspace.host(
            ArgusProtocol.Commands.GitSetRemoteUrl.self, .init(id: id, name: name, url: pushURL, push: true),
            label: "Setting \(name)'s push URL", track: .remote)
        }
        await load()
      }
    }
  }

  private func run<C: RemoteCommand>(_ label: String, _ command: C.Type, _ params: C.Params) {
    Task {
      await workspace.host(command, params, label: label, track: .remote)
      await load()
    }
  }

  private func load() async {
    switch await GitToolRead.request(store, ArgusProtocol.Commands.GitListRemotes.self, .init(id: id)) {
    case .success(let list):
      remotes = list
      loadError = nil
    case .failure(let error):
      loadError = error.message
    }
  }
}

private struct RemoteRow: View {
  let remote: ArgusProtocol.GitRemoteRich
  let act: (Action) -> Void

  enum Action { case rename, setURL, remove, copyURL }

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: remote.scheme == .ssh ? "key" : "globe").foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(remote.name).font(.scaled(size: 13, weight: .medium))
          if !remote.host.isEmpty, !remote.fetchUrl.hasPrefix(remote.host) { Badge(label: remote.host, tone: .muted) }
        }
        Text(remote.fetchUrl).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
        if let push = remote.pushUrl, push != remote.fetchUrl {
          Text("push: \(push)").font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
            .lineLimit(1).truncationMode(.middle)
        }
      }
      Spacer()
      Text("\(Int(remote.refs)) refs").font(.scaled(.callout)).foregroundStyle(.secondary)
      Menu {
        items
      } label: {
        Image(systemName: "ellipsis")
      }
      .menuStyle(.borderlessButton)
      .clickable()
      .menuIndicator(.hidden)
      .fixedSize()
    }
    .contextMenu { items }
  }

  @ViewBuilder
  private var items: some View {
    Button("Rename…") { act(.rename) }
    Button("Change URL…") { act(.setURL) }
    Button("Copy URL") { act(.copyURL) }
    Divider()
    Button("Remove…", role: .destructive) { act(.remove) }
  }
}

/// What the remote sheet is editing.
enum RemoteEdit: Identifiable {
  case add
  case rename(String)
  case setURL(String, fetch: String, push: String?)

  var id: String {
    switch self {
    case .add: "add"
    case .rename(let name): "rename:\(name)"
    case .setURL(let name, _, _): "url:\(name)"
    }
  }
}

private struct RemoteEditSheet: View {
  @Environment(\.dismiss) private var dismiss
  let edit: RemoteEdit
  let existing: [String]
  let save: (Values) -> Void

  struct Values {
    var name = ""
    var url = ""
    var pushURL = ""
  }

  @State private var values = Values()

  var body: some View {
    Form {
      switch edit {
      case .add:
        TextField("Name", text: $values.name, prompt: Text("origin"))
        TextField("URL", text: $values.url, prompt: Text("git@github.com:owner/repo.git"))
      case .rename:
        TextField("New name", text: $values.name)
      case .setURL:
        TextField("URL", text: $values.url)
        TextField("Push URL", text: $values.pushURL, prompt: Text("Same as URL"))
      }
      if let problem, !problem.isEmpty {
        Text(problem).foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .safeAreaInset(edge: .top) {
      Text(title).font(.scaled(.headline)).frame(maxWidth: .infinity, alignment: .leading).padding([.top, .horizontal], 20)
    }
    .frame(width: 440)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button("Save") {
          save(trimmed)
          dismiss()
        }
        .disabled(problem != nil)
      }
    }
    .onAppear {
      switch edit {
      case .add: break
      case .rename(let name): values.name = name
      case .setURL(_, let fetch, let push):
        values.url = fetch
        values.pushURL = push == fetch ? "" : push ?? ""
      }
    }
  }

  private var title: String {
    switch edit {
    case .add: "Add Remote"
    case .rename(let name): "Rename “\(name)”"
    case .setURL(let name, _, _): "Change “\(name)” URL"
    }
  }

  private var trimmed: Values {
    Values(
      name: values.name.trimmingCharacters(in: .whitespaces),
      url: values.url.trimmingCharacters(in: .whitespaces),
      pushURL: values.pushURL.trimmingCharacters(in: .whitespaces))
  }

  /// Why Save is disabled, if it is.
  private var problem: String? {
    let v = trimmed
    switch edit {
    case .add:
      if v.name.isEmpty || v.url.isEmpty { return "" }
      if existing.contains(v.name) { return "A remote named “\(v.name)” already exists." }
    case .rename(let from):
      if v.name.isEmpty || v.name == from { return "" }
      if existing.contains(v.name) { return "A remote named “\(v.name)” already exists." }
      if v.name.contains(" ") { return "Remote names can't contain spaces." }
    case .setURL:
      if v.url.isEmpty { return "" }
    }
    if case .add = edit, v.name.contains(" ") { return "Remote names can't contain spaces." }
    return nil
  }
}
