import SwiftUI

/// `/`: the project picker.
struct HomeScreen: View {
  var body: some View {
    ContentUnavailableView(
      "Pick a session", systemImage: "sidebar.left",
      description: Text("Choose a session in the sidebar, or create one."))
  }
}
