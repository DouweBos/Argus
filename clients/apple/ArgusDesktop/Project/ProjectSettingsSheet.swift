import SwiftUI

/// Project Settings: the project's `.argus.json` plus its personal settings.
struct ProjectSettingsSheet: View {
  let repoRoot: String
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ContentUnavailableView("Coming soon", systemImage: "hammer")
      .frame(width: 480, height: 320)
      .toolbar { Button("Done") { dismiss() } }
  }
}
