import ArgusUI
import SwiftUI

/// `/usage`: how much of each Claude plan window is left.
struct UsageScreen: View {
  @Environment(HostStore.self) private var host

  var body: some View {
    HostUsageLimitsView()
      .navigationTitle("Usage")
      .toolbar {
        ToolbarItem {
          Button {
            Task { await host.loadUsageLimits(refresh: true) }
          } label: {
            Label("Refresh", systemImage: Icon.refresh)
          }
          .disabled(host.usageLimitsLoading)
          .help("Check plan limits now")
        }
      }
  }
}
