import ArgusUI
import SwiftUI

/// ⌃G: "Go to Line…", taking `line` or `line:column`.
struct GoToLineView: View {
  let document: EditorDocument
  @State private var input = ""
  @FocusState private var focused: Bool
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      TextField("Go to Line…", text: $input)
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 12, design: .monospaced))
        .focused($focused)
        .onSubmit(go)
        .accessibilityLabel("Go to line")
      Text(hint)
        .font(.system(size: 11))
        .foregroundStyle(target == nil && !input.isEmpty ? theme.error : theme.textMuted)
    }
    .padding(8)
    .frame(width: 320)
    .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.border))
    .shadow(radius: 12)
    .padding(.top, 8)
    .onExitCommand(perform: close)
    .onAppear { focused = true }
    .onChange(of: focused) { _, isFocused in
      if !isFocused { document.isGoToLineVisible = false }
    }
  }

  private var target: GoToLineTarget? { GoToLineTarget(input) }

  private var hint: String {
    if input.isEmpty { return "Line 1–\(document.lineCount), or line:column" }
    guard let target else { return "Type a line number, or line:column" }
    return target.column.map { "Go to line \(target.line), column \($0)" } ?? "Go to line \(target.line)"
  }

  private func go() {
    guard let target else { return NSSound.beep() }
    document.isGoToLineVisible = false
    document.go(to: target)
  }

  private func close() {
    document.isGoToLineVisible = false
    document.focus()
  }
}
