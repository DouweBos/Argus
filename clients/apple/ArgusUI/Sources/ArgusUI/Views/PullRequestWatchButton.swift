import ArgusCore
import SwiftUI

/// Starts or stops the computer watching a session's open PR, which wakes its
/// agent on failing checks, conflicts and comments. A menu item: on the Mac's
/// PR icon and session menu, and the phone's session rows.
public struct PullRequestWatchButton: View {
  @Environment(HostStore.self) private var host
  let session: RemoteSession

  public init(session: RemoteSession) {
    self.session = session
  }

  public var body: some View {
    if let pullRequest = session.pullRequest, pullRequest.isOpen, host.hasControl {
      let watching = session.pullRequestWatched == true
      Button(
        watching ? "Stop Watching Pull Request" : "Watch Pull Request",
        systemImage: watching ? Icon.eyeSlash : Icon.eye
      ) {
        Task {
          await host.setPullRequestWatched(sessionId: session.id, repoRoot: session.repoRoot, watching: !watching)
        }
      }
      .help(watching ? "" : "Wake this session's agent when a check fails or passes, the branch conflicts, or someone comments")
    }
  }
}
