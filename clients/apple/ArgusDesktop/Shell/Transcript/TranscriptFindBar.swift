import ArgusUI
import SwiftUI

/// Find in chat: Return / ⇧Return (and ⌘G / ⇧⌘G) step through matches, Esc closes.
struct TranscriptFindBar: View {
  @Environment(\.theme) private var theme
  @Environment(TranscriptModel.self) private var model
  @FocusState private var focused: Bool

  var body: some View {
    @Bindable var model = model
    HStack(spacing: 6) {
      Image(systemName: Icon.search)
        .font(.system(size: 11))
        .foregroundStyle(theme.textMuted)
      TextField("Find in chat", text: $model.query)
        .textFieldStyle(.plain)
        .font(.system(size: 13))
        .frame(minWidth: 160)
        .focused($focused)
        .onKeyPress(.return, phases: .down) { press in
          model.step(forward: !press.modifiers.contains(.shift))
          return .handled
        }
        .onExitCommand { model.closeFind() }
      Text(TranscriptSearch.counter(query: model.query, count: model.hits.count, current: model.current))
        .font(.system(size: 11).monospacedDigit())
        .foregroundStyle(theme.textMuted)
        .fixedSize()
      Divider().frame(height: 14)
      IconBtn(systemName: Icon.chevronUp, label: "Previous match (⇧Return)", size: 11) {
        model.step(forward: false)
      }
      .disabled(model.hits.isEmpty)
      IconBtn(systemName: Icon.chevronDown, label: "Next match (Return)", size: 11) {
        model.step(forward: true)
      }
      .disabled(model.hits.isEmpty)
      IconBtn(systemName: Icon.close, label: "Close (Esc)", size: 11) { model.closeFind() }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .frame(maxWidth: 420)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
    .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    .onAppear { focused = true }
    .onChange(of: model.findFocusToken) { focused = true }
  }
}
