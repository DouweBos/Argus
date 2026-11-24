import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// Blame from GroveUIKit, with Argus's own parts: the route names the file and revision, a picked file moves it,
/// a line opens in the code view and a commit shows in History.
struct BlameView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let path: String?
  let ref: String?
  private var blame: BlameViewModel { workspace.blame }

  var body: some View {
    GitBlameView(viewModel: blame, host: host)
      .padding([.horizontal, .bottom], 12)
      .padding(.top, 10)
      .gitFeatures(workspace.features)
      .gitUIHost(uiHost)
      .task(id: "\(path ?? "")@\(ref ?? "")") { await open() }
  }

  private var host: GitBlameHost {
    var host = GitBlameHost()
    host.pick = { [navigate] in navigate(.blame(path: $0, ref: nil)) }
    host.showInHistory = { [workspace, navigate] sha in
      navigate(.history)
      Task { await workspace.history.reveal(sha) }
    }
    host.fileIcon = { AnyView(FileTypeIcon(path: $0)) }
    return host
  }

  /// Argus's clipboard, and the code view for a line of the file as it is now.
  private var uiHost: GitUIHost {
    var host = GitUIHost.argus(openLine: nil)
    let sessionId = workspace.sessionId
    host.openFile = { [model] path, line in model.openCode(session: sessionId, path: path, line: line, source: .blame) }
    return host
  }

  /// The route is the truth: no path is the picker, whatever was open before.
  private func open() async {
    guard let path else {
      if blame.selectedFile != nil { blame.close() }
      return
    }
    let revision = ref.flatMap { $0.isEmpty ? nil : $0 }
    if blame.selectedFile == path, blame.revision == revision, !blame.lines.isEmpty { return }
    await blame.open(file: path, revision: revision)
  }

  private var navigate: (GitRoute) -> Void {
    { [model, workspace] route in model.navigate(.sessionGit(id: workspace.sessionId, view: route)) }
  }
}
