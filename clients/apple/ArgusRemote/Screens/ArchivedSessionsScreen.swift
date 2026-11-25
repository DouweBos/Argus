import ArgusUI
import SwiftUI

/// Archived sessions, to open or restore; the Mac's `/sessions/archived`.
struct ArchivedSessionsScreen: View {
  @Environment(Router.self) private var router
  @State private var triageSheet: SessionTriageSheet?

  var body: some View {
    ArchivedSessionsList(open: { session in
      router.push(.session(id: session.id, label: session.displayName ?? session.branch, repoRoot: session.repoRoot))
    }) { session in
      AnyView(SessionTriageMenu(session: session) { triageSheet = $0 })
    }
    .sessionTriageSheet($triageSheet)
  }
}
