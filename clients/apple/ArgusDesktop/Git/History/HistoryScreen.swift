import ArgusUI
import GroveKit
import SwiftUI

struct HistoryScreen: View {
  let workspace: GitWorkspace
  let history: HistoryViewModel
  let ref: String?
  let baseBranch: String?
  var body: some View {
    ContentUnavailableView("HistoryScreen", systemImage: "hammer", description: Text("Not built yet."))
  }
}
