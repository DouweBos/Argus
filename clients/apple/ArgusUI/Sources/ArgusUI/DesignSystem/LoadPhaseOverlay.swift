import ArgusCore
import SwiftUI

extension View {
  /// `.emptyState(when:)` for a list that loads: a centred loading indicator
  /// before its first answer, the error with a retry when that failed, and
  /// `empty` only once a load came back with nothing. Rows on screen are never
  /// covered, so a refresh behind them doesn't flash anything.
  public func loadPhase<Empty: View>(
    _ phase: LoadPhase, loading label: String = "Loading…", failedTitle: String = "Couldn't load this",
    grouped: Bool = true, retry: (() async -> Void)? = nil, @ViewBuilder empty: () -> Empty
  ) -> some View {
    let empty = empty()
    return emptyState(when: !phase.showsContent, grouped: grouped) {
      switch phase {
      case .loading:
        Loading(label: label).frame(maxHeight: .infinity)
      case .failed(let error):
        EmptyState(icon: Icon.warning, title: failedTitle, body: error, selectable: true) {
          if let retry {
            Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh) {
              Task { await retry() }
            }
            .fixedSize()
          }
        }
      case .empty:
        empty
      case .content:
        EmptyView()
      }
    }
  }
}
