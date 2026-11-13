import ArgusCore
import ArgusUI
import SwiftUI

/// The context card's plan limits for the agent in front: a row that opens
/// Usage, then a compact meter per window. Nothing when the runner has none.
struct UsageLimitsContextRows: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let runner: String?

  var body: some View {
    let groups = UsageLimitFormat.groups(store.usageLimits, runner: runner)
    VStack(alignment: .leading, spacing: 0) {
      if !groups.isEmpty {
        ContextCardDivider()
        Button {
          MacTelemetry.capture(.contextCardUsed(action: .usageLimits))
          model.navigate(.usage(.limits))
        } label: {
          ContextCardRow(icon: Icon.usage, title: "Usage Limits")
        }
        .buttonStyle(ContextRowButtonStyle())
        .help("Open plan limits in Usage")
        AgentUsageLimits(groups: groups)
          .padding(.horizontal, 7)
          .padding(.top, 2)
          .padding(.bottom, 6)
      }
    }
    .task { await store.loadUsageLimitsIfMissing() }
  }
}
