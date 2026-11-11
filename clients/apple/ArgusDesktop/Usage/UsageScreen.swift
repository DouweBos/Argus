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
      .environment(\.usageNavigation, .desktop(model, host: host))
      .navigationTitle("Usage")
      .toolbar {
        if tab != .limits {
          ToolbarItem {
            Button {
              model.navigate(.usagePrices)
            } label: {
              Label("Model prices", systemImage: Icon.price)
            }
            .help("Set prices for models the price list doesn't know")
          }
        }
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
      .pageKeys { typed in
        switch typed {
        case "c": go(.cost, currentRange)
        case "t": go(.tokens, currentRange)
        case "l": go(.limits, currentRange)
        case UsageKeys.escape: model.goBack(via: .shortcut)
        default: return false
        }
        return true
      }
      .background {
        // ⌘⇧1–4 pick the range, as the segmented control orders them.
        ForEach(Array(ArgusProtocol.UsageRange.all.enumerated()), id: \.offset) { index, next in
          Button(next.label) { go(tab, next) }
            .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: [.command, .shift])
            .disabled(tab == .limits)
            .hidden()
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

enum UsageKeys {
  static let escape: Character = "\u{1b}"
}

extension UsageNavigation {
  /// Each opens its route; "Set price" leaves the model for the editor to add.
  @MainActor
  static func desktop(_ model: DesktopModel, host: HostStore) -> UsageNavigation {
    UsageNavigation(
      openModel: { key, tab, range in
        model.navigate(.usageModel(tab, runner: key.runner, model: key.model, range: range == .default ? nil : range))
      },
      openPrices: { added in
        host.pendingPriceModel = added
        model.navigate(.usagePrices)
      })
  }
}
