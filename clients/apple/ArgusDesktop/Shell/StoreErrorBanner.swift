import ArgusCore
import ArgusUI
import SwiftUI

/// The last thing the host refused or failed — a permission answer it didn't
/// take, a spawn it declined — which the stores only record on `lastError`.
struct StoreErrorBanner: View {
  @Environment(HostStore.self) private var store

  var body: some View {
    if let error = store.lastError {
      Banner(text: error, tone: .danger, actionLabel: "Dismiss") { store.clearError() }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        // A new message restarts the clock; one left alone goes after a while.
        .task(id: error) {
          try? await Task.sleep(for: .seconds(12))
          if store.lastError == error { store.clearError() }
        }
    }
  }
}
