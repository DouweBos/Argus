import SwiftUI

/// A labelled option row grid, used instead of nav-bar actions so screen
/// titles keep their width.
public struct ActionTiles: View {
  public struct Action: Identifiable {
    public let id = UUID()
    public var label: String
    public var icon: String
    public var disabled = false
    public var run: () -> Void

    public init(label: String, icon: String, disabled: Bool = false, run: @escaping () -> Void) {
      self.label = label
      self.icon = icon
      self.disabled = disabled
      self.run = run
    }
  }

  @Environment(\.theme) private var theme
  let actions: [Action]

  public init(actions: [Action]) {
    self.actions = actions
  }

  public var body: some View {
    HStack(spacing: 6) {
      ForEach(actions) { action in
        Button(action: action.run) {
          VStack(spacing: 5) {
            Image(systemName: action.icon).font(.scaled(size: 16, weight: .medium))
            Text(action.label).font(.scaled(size: 10, weight: .medium)).lineLimit(1)
          }
          .foregroundStyle(action.disabled ? theme.textMuted : theme.textSecondary)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 10)
          .background(theme.bgSecondary)
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          .overlay(
            RoundedRectangle(cornerRadius: theme.radiusSmall)
              .stroke(theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(action.disabled)
        .opacity(action.disabled ? 0.5 : 1)
      }
    }
  }
}

public struct SegmentedControl<Value: Hashable>: View {
  @Environment(\.theme) private var theme
  @Binding var value: Value
  let options: [(value: Value, label: String)]

  public init(value: Binding<Value>, options: [(value: Value, label: String)]) {
    self._value = value
    self.options = options
  }

  public var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.value) { option in
        Button {
          value = option.value
        } label: {
          Text(option.label)
            .font(.scaled(size: 13, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .foregroundStyle(value == option.value ? theme.onAccent : theme.textSecondary)
            .background(value == option.value ? theme.accent : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall - 2))
        }
        .buttonStyle(.plain)
      }
    }
    .padding(2)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }
}

public struct ThemedTextField: View {
  /// Drives keyboard assistance: prose gets autocorrect and predictions,
  /// code (branches, globs, pairing codes) must be typed verbatim.
  public enum Input { case prose, name, code }

  /// The on-screen keyboard to offer; ignored where there is none.
  public enum Keyboard { case `default`, decimalPad }

  @Environment(\.theme) private var theme
  let placeholder: String
  @Binding var text: String
  var multiline = false
  var lines: ClosedRange<Int> = 2...6
  var keyboard: Keyboard = .default
  var mono = false
  var input: Input = .prose
  var onSubmit: (() -> Void)?

  public init(
    placeholder: String,
    text: Binding<String>,
    multiline: Bool = false,
    lines: ClosedRange<Int> = 2...6,
    keyboard: Keyboard = .default,
    mono: Bool = false,
    input: Input = .prose,
    onSubmit: (() -> Void)? = nil
  ) {
    self.placeholder = placeholder
    self._text = text
    self.multiline = multiline
    self.lines = lines
    self.keyboard = keyboard
    self.mono = mono
    self.input = input
    self.onSubmit = onSubmit
  }

  public var body: some View {
    Group {
      if multiline {
        TextField(placeholder, text: $text, axis: .vertical).lineLimit(lines)
      } else {
        TextField(placeholder, text: $text)
      }
    }
    .font(mono ? .scaled(size: 14, design: .monospaced) : .scaled(size: 15))
    .foregroundStyle(theme.text)
    .platformKeyboard(keyboard, input: input)
    .autocorrectionDisabled(input == .code)
    .padding(.horizontal, 10)
    .padding(.vertical, 9)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(
      RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1)
    )
    .onSubmit { onSubmit?() }
  }

}

extension View {
  fileprivate func platformKeyboard(
    _ keyboard: ThemedTextField.Keyboard, input: ThemedTextField.Input
  ) -> some View {
    #if os(iOS)
      let capitalization: TextInputAutocapitalization =
        switch input {
        case .prose: .sentences
        case .name: .words
        case .code: .never
        }
      return keyboardType(keyboard == .decimalPad ? .decimalPad : .default)
        .textInputAutocapitalization(capitalization)
    #else
      return self
    #endif
  }
}

/// A bottom sheet of options. Single-select closes on tap; multi-select stays
/// open so several can be toggled in one go.
public struct PickerSheet<Value: Hashable>: View {
  public struct Option: Identifiable {
    public var id: Value { value }
    public var value: Value
    public var label: String
    public var hint: String?

    public init(value: Value, label: String, hint: String? = nil) {
      self.value = value
      self.label = label
      self.hint = hint
    }
  }

  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss

  let title: String
  let options: [Option]
  var selected: Set<Value>
  var multi = false
  var emptyMessage: String?
  let onPick: (Value) -> Void

  public init(
    title: String,
    options: [Option],
    selected: Set<Value>,
    multi: Bool = false,
    emptyMessage: String? = nil,
    onPick: @escaping (Value) -> Void
  ) {
    self.title = title
    self.options = options
    self.selected = selected
    self.multi = multi
    self.emptyMessage = emptyMessage
    self.onPick = onPick
  }

  public var body: some View {
    NavigationStack {
      Group {
        if options.isEmpty {
          EmptyState(
            icon: Icon.search, title: title,
            body: emptyMessage ?? "Nothing to choose from yet.")
        } else {
          List {
            ForEach(options) { option in
              Button {
                onPick(option.value)
                if !multi { dismiss() }
              } label: {
                HStack(spacing: 10) {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(option.label)
                      .font(.scaled(size: 15))
                      .foregroundStyle(theme.text)
                    if let hint = option.hint, !hint.isEmpty {
                      Text(hint)
                        .font(.scaled(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                    }
                  }
                  Spacer(minLength: 8)
                  if selected.contains(option.value) {
                    Image(systemName: Icon.check)
                      .font(.scaled(size: 13, weight: .bold))
                      .foregroundStyle(theme.accent)
                  }
                }
                // Without a hit shape the tap target collapses onto the glyphs.
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .listRowBackground(theme.bgSecondary)
            }
          }
          .listStyle(.plain)
          .scrollContentBackground(.hidden)
        }
      }
      .background(theme.bg)
      .navigationTitle(title)
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }.foregroundStyle(theme.accent)
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }
}
