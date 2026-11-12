import SwiftUI
import WidgetKit

@main
struct ArgusWidgetsBundle: WidgetBundle {
  var body: some Widget {
    AgentsWidget()
    InboxWidget()
    UsageWidget()
    QuickAgentControl()
    AgentLiveActivity()
  }
}
