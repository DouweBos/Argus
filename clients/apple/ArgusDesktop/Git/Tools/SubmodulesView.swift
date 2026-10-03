import ArgusUI
import GroveKit
import SwiftUI

/// The project's submodules with their status, and init / update / deinit, as
/// Electron's `SubmodulesView`.
struct SubmodulesView: View {
  @Environment(HostStore.self) private var store
  let workspace: GitWorkspace

  @State private var submodules: [ArgusProtocol.GitSubmodule]?
  @State private var loadError: String?
  @State private var deinitTarget: ArgusProtocol.GitSubmodule?

  var body: some View {
    VStack(spacing: 0) {
      GitToolHeader(title: "Submodules", caption: caption) {
        Button("Init All") { run("Initializing submodules", ArgusProtocol.Commands.GitSubmoduleInit.self, .init(id: id)) }
          .disabled(!hasUninitialized || workspace.hostBusy != nil)
        Button("Update All") {
          run("Updating submodules", ArgusProtocol.Commands.GitSubmoduleUpdate.self, .init(id: id))
        }
        .disabled(submodules?.isEmpty ?? true || workspace.hostBusy != nil)
      }
      Divider()
      content.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .task(id: workspace.generation) { await load() }
    .confirmationDialog(
      "Deinit \(deinitTarget?.path ?? "")?", isPresented: deinitShown, presenting: deinitTarget
    ) { target in
      Button("Deinit", role: .destructive) {
        run("Deinitializing \(target.path)", ArgusProtocol.Commands.GitSubmoduleDeinit.self,
            .init(id: id, path: target.path, force: true))
      }
    } message: { _ in
      Text("This removes its working tree but keeps the .gitmodules entry.")
    }
  }

  private var id: String { workspace.sessionId }

  private var caption: String? {
    guard let submodules, !submodules.isEmpty else { return nil }
    return "\(submodules.count) submodule\(submodules.count == 1 ? "" : "s")"
  }

  private var hasUninitialized: Bool {
    submodules?.contains { $0.status == .uninitialized } ?? false
  }

  @ViewBuilder
  private var content: some View {
    if let loadError {
      ContentUnavailableView {
        Label("Couldn't list submodules", systemImage: "exclamationmark.triangle")
      } description: {
        Text(loadError)
      } actions: {
        Button("Try Again") { Task { await load() } }
      }
    } else if let submodules {
      if submodules.isEmpty {
        ContentUnavailableView(
          "No submodules", systemImage: "shippingbox",
          description: Text("This repository doesn't use git submodules."))
      } else {
        List(submodules, id: \.path) { submodule in
          SubmoduleRow(submodule: submodule, busy: workspace.hostBusy != nil) { action in
            perform(action, on: submodule)
          }
        }
        .listStyle(.inset)
      }
    } else {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var deinitShown: Binding<Bool> {
    Binding(get: { deinitTarget != nil }, set: { if !$0 { deinitTarget = nil } })
  }

  private func perform(_ action: SubmoduleRow.Action, on submodule: ArgusProtocol.GitSubmodule) {
    let path = submodule.path
    switch action {
    case .initialize:
      run("Initializing \(path)", ArgusProtocol.Commands.GitSubmoduleInit.self, .init(id: id, path: path))
    case .update:
      run("Updating \(path)", ArgusProtocol.Commands.GitSubmoduleUpdate.self, .init(id: id, path: path))
    case .updateRemote:
      run(
        "Updating \(path) from its remote", ArgusProtocol.Commands.GitSubmoduleUpdate.self,
        .init(id: id, path: path, remote: true))
    case .deinitialize:
      deinitTarget = submodule
    case .copyURL:
      Clipboard.copy(submodule.url)
    }
  }

  private func run<C: RemoteCommand>(_ label: String, _ command: C.Type, _ params: C.Params) {
    Task {
      await workspace.host(command, params, label: label, track: .submodule)
      await load()
    }
  }

  private func load() async {
    switch await GitToolRead.request(store, ArgusProtocol.Commands.GitSubmoduleList.self, .init(id: id)) {
    case .success(let list):
      submodules = list
      loadError = nil
    case .failure(let error):
      loadError = error.message
    }
  }
}

/// One submodule: name, url, path, pinned commit, status and its actions.
private struct SubmoduleRow: View {
  @Environment(\.theme) private var theme
  let submodule: ArgusProtocol.GitSubmodule
  let busy: Bool
  let act: (Action) -> Void

  enum Action { case initialize, update, updateRemote, deinitialize, copyURL }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "shippingbox").foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(submodule.name).font(.system(size: 13, weight: .medium))
          if submodule.path != submodule.name {
            Text(submodule.path).font(.system(size: 12, design: .monospaced)).foregroundStyle(.secondary)
          }
        }
        Text(submodule.url)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
          .help(submodule.url)
      }
      Spacer(minLength: 8)
      if !submodule.commitHash.isEmpty {
        Text(String(submodule.commitHash.prefix(8)))
          .font(.system(size: 11, design: .monospaced))
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
      }
      Badge(label: submodule.status.rawValue, tone: tone)
      actions
    }
    .padding(.vertical, 4)
    .contextMenu {
      menuItems
      Divider()
      Button("Copy URL") { act(.copyURL) }
    }
  }

  private var actions: some View {
    HStack(spacing: 6) {
      if submodule.status == .uninitialized {
        Button("Init") { act(.initialize) }
      }
      Button("Update") { act(.update) }
      Menu {
        menuItems
      } label: {
        Image(systemName: "ellipsis")
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
    }
    .controlSize(.small)
    .disabled(busy)
  }

  @ViewBuilder
  private var menuItems: some View {
    if submodule.status == .uninitialized {
      Button("Init") { act(.initialize) }
    }
    Button("Update") { act(.update) }
    Button("Update from Remote") { act(.updateRemote) }
    Divider()
    Button("Deinit…", role: .destructive) { act(.deinitialize) }
      .disabled(submodule.status == .uninitialized)
  }

  private var tone: Tone {
    switch submodule.status {
    case .clean: .success
    case .modified: .warning
    default: .muted
    }
  }
}
