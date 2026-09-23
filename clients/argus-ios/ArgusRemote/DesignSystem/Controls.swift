import SwiftUI
import UIKit

/// A labelled option row grid, used instead of nav-bar actions so screen
/// titles keep their width.
struct ActionTiles: View {
  struct Action: Identifiable {
    let id = UUID()
    var label: String
    var icon: String
    var disabled = false
    var run: () -> Void
  }

  @Environment(\.theme) private var theme
  let actions: [Action]

  var body: some View {
    HStack(spacing: 6) {
      ForEach(actions) { action in
        Button(action: action.run) {
          VStack(spacing: 5) {
            Image(systemName: action.icon).font(.system(size: 16, weight: .medium))
            Text(action.label).font(.system(size: 10, weight: .medium)).lineLimit(1)
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

struct SegmentedControl<Value: Hashable>: View {
  @Environment(\.theme) private var theme
  @Binding var value: Value
  let options: [(value: Value, label: String)]

  var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.value) { option in
        Button {
          value = option.value
        } label: {
          Text(option.label)
            .font(.system(size: 13, weight: .semibold))
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

struct ThemedTextField: View {
  @Environment(\.theme) private var theme
  let placeholder: String
  @Binding var text: String
  var multiline = false
  var lines: ClosedRange<Int> = 2...6
  var keyboard: UIKeyboardType = .default
  var mono = false
  var onSubmit: (() -> Void)?

  var body: some View {
    Group {
      if multiline {
        TextField(placeholder, text: $text, axis: .vertical).lineLimit(lines)
      } else {
        TextField(placeholder, text: $text)
      }
    }
    .font(mono ? .system(size: 14, design: .monospaced) : .system(size: 15))
    .foregroundStyle(theme.text)
    .keyboardType(keyboard)
    .textInputAutocapitalization(.never)
    .autocorrectionDisabled()
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

/// A bottom sheet of options. Single-select closes on tap; multi-select stays
/// open so several can be toggled in one go.
struct PickerSheet<Value: Hashable>: View {
  struct Option: Identifiable {
    var id: Value { value }
    var value: Value
    var label: String
    var hint: String?
  }

  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss

  let title: String
  let options: [Option]
  var selected: Set<Value>
  var multi = false
  var emptyMessage: String?
  let onPick: (Value) -> Void

  var body: some View {
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
                      .font(.system(size: 15))
                      .foregroundStyle(theme.text)
                    if let hint = option.hint, !hint.isEmpty {
                      Text(hint)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                    }
                  }
                  Spacer(minLength: 8)
                  if selected.contains(option.value) {
                    Image(systemName: Icon.check)
                      .font(.system(size: 13, weight: .bold))
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
      .navigationBarTitleDisplayMode(.inline)
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
