import ArgusCore
import ArgusUI
import SwiftTerm
import SwiftUI

/// Find in the focused terminal's scrollback, one bar per panel.
@MainActor
@Observable
final class TerminalSearchState {
  var visible = false
  var query = "" {
    didSet { if query != oldValue { step(forward: true, fresh: true) } }
  }
  private(set) var total = 0
  private(set) var index = 0
  private(set) var focusToken = 0
  /// Whether this search moved through matches, for telemetry.
  private(set) var navigated = false
  @ObservationIgnored private weak var view: TerminalView?

  func bind(_ view: TerminalView) {
    guard self.view !== view else { return }
    self.view?.clearSearch()
    self.view = view
    if visible { step(forward: true, fresh: true) }
  }

  func open() {
    visible = true
    focusToken += 1
  }

  func close() {
    if !query.isEmpty {
      MacTelemetry.capture(
        .terminalFindUsed(matches: MacTelemetryEvent.countBucket(total), navigated: navigated))
    }
    visible = false
    navigated = false
    view?.clearSearch()
    if let view { view.window?.makeFirstResponder(view) }
  }

  func step(forward: Bool, fresh: Bool = false) {
    guard let view else { return }
    guard !query.isEmpty else {
      view.clearSearch()
      (total, index) = (0, 0)
      return
    }
    if !fresh { navigated = true }
    if fresh { view.clearSearch() }
    _ = forward ? view.findNext(query) : view.findPrevious(query)
    (index, total) = view.searchMatchSummary(query)
  }

  var counter: String {
    TranscriptSearch.counter(query: query, count: total, current: index > 0 ? index - 1 : nil)
  }
}

/// Return / ⇧Return step through matches, Esc closes and returns to the shell.
struct TerminalFindBar: View {
  @Environment(\.theme) private var theme
  @Bindable var search: TerminalSearchState
  @FocusState private var focused: Bool

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: Icon.search)
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textMuted)
      TextField("Find in terminal", text: $search.query)
        .textFieldStyle(.plain)
        .font(.scaled(size: 13))
        .frame(minWidth: 160)
        .focused($focused)
        .onKeyPress(.return, phases: .down) { press in
          search.step(forward: !press.modifiers.contains(.shift))
          return .handled
        }
        .onExitCommand { search.close() }
      Text(search.counter)
        .font(.scaled(size: 11).monospacedDigit())
        .foregroundStyle(theme.textMuted)
        .fixedSize()
      Divider().frame(height: 14)
      IconBtn(systemName: Icon.chevronUp, label: "Previous match (⇧Return)", size: 11) {
        search.step(forward: false)
      }
      .disabled(search.total == 0)
      IconBtn(systemName: Icon.chevronDown, label: "Next match (Return)", size: 11) {
        search.step(forward: true)
      }
      .disabled(search.total == 0)
      IconBtn(systemName: Icon.close, label: "Close (Esc)", size: 11) { search.close() }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .frame(maxWidth: 420)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
    .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    .onAppear { focused = true }
    .onChange(of: search.focusToken) { focused = true }
  }
}
