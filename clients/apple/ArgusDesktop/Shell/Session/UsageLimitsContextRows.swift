import ArgusCore
import ArgusUI
import SwiftUI

/// The context card's plan limit for the agent in front: how much of the
/// current session window it has used, opening Usage. Nothing without one.
struct UsageLimitsContextRows: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let runner: String?
  let accountId: String?

  var body: some View {
    let window = UsageLimitFormat.sessionWindow(store.usageLimits, runner: runner, accountId: accountId)
    VStack(alignment: .leading, spacing: 0) {
      if let window {
        Button {
          MacTelemetry.capture(.contextCardUsed(action: .usageLimits))
          model.navigate(.usage(.limits))
        } label: {
          ContextCardRow(icon: Icon.usage, title: "Session Usage") {
            SessionUsagePercent(window: window).font(.scaled(size: 11))
          }
        }
        .buttonStyle(ContextRowButtonStyle())
        .help(AgentUsageLimits.help(window, now: .now) + " · Open plan limits in Usage")
      }
    }
    .task { await store.loadUsageLimitsIfMissing() }
  }
}
