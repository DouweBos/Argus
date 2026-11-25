import ArgusCore
import ArgusUI
import SwiftUI

/// `/sessions/archived`: archived sessions, to open or restore.
struct ArchivedSessionsScreen: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    ArchivedSessionsList(open: { model.open(session: $0.id) }) { session in
      AnyView(SidebarSessionMenu(session: session))
    }
    .sessionTriageSheets()
  }
}
