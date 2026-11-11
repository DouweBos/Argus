import ArgusUI
import SwiftUI

/// `/usage`, `/usage/cost`, `/usage/tokens`: plan limits, then cost and tokens
/// from every runner's sessions. Tab and range are the route.
struct UsageScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var host
  let tab: UsageTab
  let range: ArgusProtocol.UsageRange?
  /// Kept while on Limits, so coming back to Cost or Tokens keeps the range.
  @State private var lastRange = ArgusProtocol.UsageRange.default

  private var currentRange: ArgusProtocol.UsageRange { tab == .limits ? lastRange : range ?? .default }

  private var tabBinding: Binding<UsageTab> {
    Binding(get: { tab }, set: { next in go(next, currentRange) })
  }

  private var rangeBinding: Binding<ArgusProtocol.UsageRange> {
    Binding(get: { currentRange }, set: { next in go(tab, next) })
  }

  private func go(_ nextTab: UsageTab, _ nextRange: ArgusProtocol.UsageRange) {
    lastRange = nextRange
    let next = DesktopRoute.usage(nextTab, range: nextTab == .limits || nextRange == .default ? nil : nextRange)
    if next != model.route { model.navigate(next) }
  }

  var body: some View {
    HostUsageView(tab: tabBinding, range: rangeBinding)
      .navigationTitle("Usage")
      .toolbar {
        ToolbarItem {
          Button {
            Task { await refresh() }
          } label: {
            Label("Refresh", systemImage: Icon.refresh)
          }
          .disabled(tab == .limits ? host.usageLimitsLoading : host.usageSummaryLoadingRange != nil)
          .help(tab == .limits ? "Check plan limits now" : "Read usage again")
        }
      }
  }

  private func refresh() async {
    if tab == .limits {
      await host.loadUsageLimits(refresh: true)
    } else {
      await host.loadUsageSummary(range: currentRange)
    }
  }
}
