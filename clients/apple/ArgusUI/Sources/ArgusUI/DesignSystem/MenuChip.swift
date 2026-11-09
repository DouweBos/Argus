import SwiftUI

/// A `Chip` showing the current choice that opens a native menu to change it:
/// the in-place pick the Mac makes, instead of a button pushing a picker sheet.
public struct MenuChip<Value: Hashable>: View {
  public struct Option: Identifiable {
    public var id: Value { value }
    public var value: Value
    public var label: String
    /// A second line under the label in the menu.
    public var hint: String?
    /// Listed, but can't be picked; the hint says why.
    public var disabled: Bool

    public init(value: Value, label: String, hint: String? = nil, disabled: Bool = false) {
      self.value = value
      self.label = label
      self.hint = hint
      self.disabled = disabled
    }
  }

  let title: String
  let options: [Option]
  @Binding var selection: Value
  var icon: String?
  var tone: Tone?
  var mono = false
  /// Prefix the chip with the title ("Runner: Default") where nothing else says what it picks.
  var showsTitle = false

  public init(
    _ title: String,
    selection: Binding<Value>,
    options: [Option],
    icon: String? = nil,
    tone: Tone? = nil,
    mono: Bool = false,
    showsTitle: Bool = false
  ) {
    self.title = title
    self._selection = selection
    self.options = options
    self.icon = icon
    self.tone = tone
    self.mono = mono
    self.showsTitle = showsTitle
  }

  public var body: some View {
    Menu {
      Picker(title, selection: $selection) {
        ForEach(options) { option in
          Button {
          } label: {
            Text(option.label)
            if let hint = option.hint { Text(hint) }
          }
          .tag(option.value)
          .disabled(option.disabled)
        }
      }
      .pickerStyle(.inline)
    } label: {
      Chip(label: chipLabel, icon: icon, tone: tone, mono: mono)
    }
    .menuIndicator(.hidden)
    .clickable()
    .accessibilityLabel("\(title): \(valueLabel)")
  }

  var valueLabel: String { Self.valueLabel(selection, in: options) }

  private var chipLabel: String { showsTitle ? "\(title): \(valueLabel)" : valueLabel }

  /// The picked option's label; a value the list doesn't carry shows as itself.
  static func valueLabel(_ value: Value, in options: [Option]) -> String {
    options.first { $0.value == value }?.label ?? String(describing: value)
  }
}

#Preview("MenuChip") {
  @Previewable @State var runner = ""
  @Previewable @State var autonomy = "draft"
  let runners: [MenuChip<String>.Option] = [
    .init(value: "", label: "Default", hint: "Use the computer's default"),
    .init(value: "codex", label: "Codex"),
    .init(
      value: "gemini", label: "Gemini CLI",
      hint: "Gemini CLI isn't installed. Install it with `npm install -g @google/gemini-cli`.", disabled: true),
  ]
  ChipFlowLayout(spacing: 6, lineSpacing: 6) {
    MenuChip("Runner", selection: $runner, options: runners, icon: Icon.terminal)
    MenuChip(
      "Autonomy", selection: $autonomy,
      options: [.init(value: "draft", label: "Draft"), .init(value: "pr", label: "Open a PR")],
      showsTitle: true)
  }
  .padding()
}
