import ArgusUI
import SwiftUI

/// `/usage/:tab/models/:runner/:model`: one model's trend, cache hit rate and price.
struct UsageModelScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var host
  let tab: UsageTab
  let key: UsageModelKey
  let range: ArgusProtocol.UsageRange?

  var body: some View {
    HostUsageModelView(metric: tab.metric ?? .cost, key: key, range: range ?? .default)
      .environment(\.usageNavigation, .desktop(model, host: host))
      .navigationTitle(key.model)
      .pageKeys { typed in
        guard typed == UsageKeys.escape else { return false }
        model.goBack(via: .shortcut)
        return true
      }
  }
}

/// `/usage/prices`: the model price editor; Save and Cancel go back.
struct UsagePricesScreen: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    HostUsagePricesView { leave(via: .button) }
      .navigationTitle("Model prices")
      .pageKeys { typed in
        guard typed == UsageKeys.escape else { return false }
        leave(via: .shortcut)
        return true
      }
  }

  private func leave(via: MacTelemetryEvent.HistorySource) {
    if model.canGoBack {
      model.goBack(via: via)
    } else {
      model.navigate(.usage(.cost))
    }
  }
}

/// `/usage/models`: which models Usage counts, the same lists as Settings → Agents.
struct UsageModelsScreen: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    HostUsageModelFilterView()
      .navigationTitle("Counted models")
      .pageKeys { typed in
        guard typed == UsageKeys.escape else { return false }
        if model.canGoBack { model.goBack(via: .shortcut) } else { model.navigate(.usage(.cost)) }
        return true
      }
  }
}
