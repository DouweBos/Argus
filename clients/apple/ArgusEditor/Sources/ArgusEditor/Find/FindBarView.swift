import ArgusUI
import SwiftUI

/// The in-editor find and replace bar.
struct FindBarView: View {
  @Bindable var model: FindModel
  @FocusState private var focused: Field?
  @Environment(\.theme) private var theme

  private enum Field { case find, replace }

  var body: some View {
    VStack(spacing: 6) {
      HStack(spacing: 6) {
        Button {
          model.showsReplace.toggle()
        } label: {
          Image(systemName: model.showsReplace ? Icon.chevronDown : Icon.chevronRight)
            .frame(width: 12)
        }
        .buttonStyle(.borderless)
        .help(model.showsReplace ? "Hide Replace" : "Show Replace")
        field("Find", text: $model.query.text, field: .find)
          .onSubmit { NSEvent.modifierFlags.contains(.shift) ? model.previous() : model.next() }
        toggle("Aa", isOn: $model.query.isCaseSensitive, help: "Match Case")
        toggle("ab", isOn: $model.query.isWholeWord, help: "Whole Word")
        toggle(".*", isOn: $model.query.isRegex, help: "Regular Expression")
        Text(model.matchSummary)
          .font(.system(size: 11))
          .foregroundStyle(model.invalidPattern ? theme.error : theme.textMuted)
          .frame(minWidth: 72, alignment: .trailing)
          .monospacedDigit()
        Button(action: model.previous) { Image(systemName: Icon.chevronUp) }
          .buttonStyle(.borderless)
          .help("Previous Match (⇧⌘G)")
          .disabled(model.matches.isEmpty)
        Button(action: model.next) { Image(systemName: Icon.chevronDown) }
          .buttonStyle(.borderless)
          .help("Next Match (⌘G)")
          .disabled(model.matches.isEmpty)
        Button("Done", action: model.hide)
          .controlSize(.small)
      }
      if model.showsReplace {
        HStack(spacing: 6) {
          Spacer().frame(width: 18)
          field("Replace", text: $model.replacement, field: .replace)
            .onSubmit(model.replaceCurrent)
          Button("Replace", action: model.replaceCurrent)
            .controlSize(.small)
            .disabled(model.matches.isEmpty)
          Button("All", action: model.replaceAll)
            .controlSize(.small)
            .disabled(model.matches.isEmpty)
          Spacer()
        }
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(theme.bgSecondary)
    .onExitCommand(perform: model.hide)
    .onAppear { focused = .find }
    .onChange(of: model.focusRequest) { focused = .find }
  }

  private func field(_ prompt: String, text: Binding<String>, field: Field) -> some View {
    TextField(prompt, text: text)
      .textFieldStyle(.roundedBorder)
      .font(.system(size: 12, design: .monospaced))
      .focused($focused, equals: field)
      .frame(minWidth: 160, maxWidth: 360)
  }

  private func toggle(_ label: String, isOn: Binding<Bool>, help: String) -> some View {
    Toggle(isOn: isOn) {
      Text(label).font(.system(size: 11, weight: .semibold, design: .monospaced))
    }
    .toggleStyle(.button)
    .controlSize(.small)
    .help(help)
  }
}
