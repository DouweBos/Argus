import AppIntents
import ArgusKit
import SwiftUI
import WidgetKit

/// Control Center button: the new-agent composer on the last active project.
/// It opens the composer rather than starting anything, since an agent needs a prompt.
struct QuickAgentControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: WidgetKind.quickAgentControl) {
      ControlWidgetButton(action: OpenNewAgentIntent()) {
        Label("New agent", systemImage: "sparkles")
      }
    }
    .displayName("New agent")
    .description("Start an agent on the project you used last.")
  }
}

struct OpenNewAgentIntent: AppIntent {
  static let title: LocalizedStringResource = "New Agent"
  static let description = IntentDescription("Opens Argus on a new agent for the project you used last.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(WidgetLink.url(path: WidgetLink.newAgentPath, source: .control)))
  }
}
