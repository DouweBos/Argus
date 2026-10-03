import ArgusUI
import GroveKit
import SwiftUI

struct WorkingCopyView: View {
  let workspace: GitWorkspace
  var body: some View {
    ContentUnavailableView("WorkingCopyView", systemImage: "hammer", description: Text("Not built yet."))
  }
}
