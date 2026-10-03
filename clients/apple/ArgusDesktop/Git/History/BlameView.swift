import ArgusUI
import GroveKit
import SwiftUI

struct BlameView: View {
  let workspace: GitWorkspace
  let path: String?
  let ref: String?
  var body: some View {
    ContentUnavailableView("BlameView", systemImage: "hammer", description: Text("Not built yet."))
  }
}
