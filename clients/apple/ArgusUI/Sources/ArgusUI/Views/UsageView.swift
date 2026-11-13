import ArgusCore
import SwiftUI

/// The Usage screen's body on both apps: plan limits, cost or tokens. Tab and
/// range are the route on the Mac and screen state on the phone.
public struct HostUsageView: View {
  @Environment(\.theme) private var theme
  @Environment(\.usageNavigation) private var navigation
  private let routed: (tab: Binding<UsageTab>, range: Binding<ArgusProtocol.UsageRange>)?
  @State private var localTab = UsageTab.limits
  @State private var localRange = ArgusProtocol.UsageRange.default

  /// Tab and range live in the caller's route.
  public init(tab: Binding<UsageTab>, range: Binding<ArgusProtocol.UsageRange>) {
    self.routed = (tab, range)
  }

  /// Tab and range are screen state.
  public init() {
    self.routed = nil
  }

  private var tab: Binding<UsageTab> { routed?.tab ?? $localTab }
  private var range: Binding<ArgusProtocol.UsageRange> { routed?.range ?? $localRange }

  public var body: some View {
    VStack(spacing: 0) {
      SegmentedControl(value: tab, options: UsageTab.allCases.map { ($0, $0.title) })
        .frame(maxWidth: 420)
        .padding([.horizontal, .top], theme.space)
        .frame(maxWidth: .infinity)
      switch tab.wrappedValue.metric {
      case nil: HostUsageLimitsView()
      case let metric?: HostUsageSummaryView(metric: metric, range: range)
      }
    }
    .background(theme.bg.ignoresSafeArea())
    #if os(iOS)
      .toolbar {
        if let navigation, tab.wrappedValue != .limits {
          ToolbarItemGroup(placement: .primaryAction) {
            Button {
              navigation.openCountedModels()
            } label: {
              Label("Counted models", systemImage: Icon.filter)
            }
            Button {
              navigation.openPrices(nil)
            } label: {
              Label("Model prices", systemImage: Icon.price)
            }
          }
        }
      }
    #endif
  }
}
