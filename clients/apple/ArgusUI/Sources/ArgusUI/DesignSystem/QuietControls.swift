import SwiftUI

/// The flat chrome's controls: tabs, checkboxes, fields and the one accent
/// button, drawn straight on the canvas without bezels.

// MARK: - Empty state

/// A quiet "nothing here": a small muted icon over a line or two, centred in the room it's given.
public struct QuietEmptyState<Actions: View>: View {
  @Environment(\.theme) private var theme
  let icon: String
  let title: String
  var message: String?
  let actions: Actions

  public init(icon: String, title: String, message: String? = nil, @ViewBuilder actions: () -> Actions) {
    self.icon = icon
    self.title = title
    self.message = message
    self.actions = actions()
  }

  public var body: some View {
    VStack(spacing: 6) {
      Image(systemName: icon)
        .font(.scaled(size: 20, weight: .light))
        .foregroundStyle(theme.textMuted)
        .padding(.bottom, 2)
      Text(title)
        .font(.scaled(size: 13, weight: .medium))
        .foregroundStyle(theme.textSecondary)
      if let message {
        Text(message)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
          .textSelection(.enabled)
      }
      actions
        .controlSize(.small)
        .padding(.top, 4)
    }
    .multilineTextAlignment(.center)
    .frame(maxWidth: 300)
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityElement(children: .contain)
  }
}

extension QuietEmptyState where Actions == EmptyView {
  public init(icon: String, title: String, message: String? = nil) {
    self.init(icon: icon, title: title, message: message) { EmptyView() }
  }
}

// MARK: - Tabs

/// A text tab: muted until hovered, a quiet fill when selected.
public struct QuietTabButtonStyle: ButtonStyle {
  var selected: Bool

  public init(selected: Bool = false) {
    self.selected = selected
  }

  public func makeBody(configuration: Configuration) -> some View {
    QuietTab(label: configuration.label, pressed: configuration.isPressed, selected: selected).clickable()
  }
}

private struct QuietTab<Label: View>: View {
  @Environment(\.theme) private var theme
  let label: Label
  let pressed: Bool
  let selected: Bool
  @State private var hovering = false

  var body: some View {
    label
      .font(.scaled(size: 12, weight: .medium))
      .lineLimit(1)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .foregroundStyle(selected || hovering ? theme.text : theme.textSecondary)
      .background {
        if selected || hovering || pressed {
          RoundedRectangle(cornerRadius: 6).fill(pressed ? theme.bgHover : theme.selection)
        }
      }
      .contentShape(.rect(cornerRadius: 6))
      .onHover { hovering = $0 }
  }
}

// MARK: - Checkbox

/// A small rounded box that fills with the accent when on; the label stays secondary.
public struct QuietCheckboxStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    QuietCheckbox(configuration: configuration)
  }
}

private struct QuietCheckbox: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let configuration: ToggleStyleConfiguration

  var body: some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      HStack(spacing: 6) {
        RoundedRectangle(cornerRadius: 4)
          .fill(configuration.isOn ? theme.accent : Color.clear)
          .overlay {
            if configuration.isOn {
              Image(systemName: "checkmark")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(theme.onAccent)
            } else {
              RoundedRectangle(cornerRadius: 4).strokeBorder(theme.borderStrong, lineWidth: 1)
            }
          }
          .frame(width: 13, height: 13)
        configuration.label
          .font(.scaled(size: 12))
          .foregroundStyle(isEnabled ? theme.textSecondary : theme.textMuted)
      }
      .opacity(isEnabled ? 1 : 0.6)
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
  }
}

extension ToggleStyle where Self == QuietCheckboxStyle {
  public static var quietCheckbox: QuietCheckboxStyle { QuietCheckboxStyle() }
}

// MARK: - Accent button

/// The one primary action on a surface: an accent fill while enabled, a quiet one when not.
public struct AccentButtonStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    AccentButton(label: configuration.label, pressed: configuration.isPressed).clickable()
  }
}

private struct AccentButton<Label: View>: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label
  let pressed: Bool

  var body: some View {
    label
      .font(.scaled(size: 12, weight: .medium))
      .lineLimit(1)
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
      .foregroundStyle(isEnabled ? theme.onAccent : theme.textMuted)
      .background(
        isEnabled ? theme.accent.opacity(pressed ? 0.8 : 1) : theme.selection, in: .rect(cornerRadius: 6))
      .contentShape(.rect(cornerRadius: 6))
  }
}

// MARK: - Secondary button

/// A clear action that isn't the primary one: a quiet fill and hairline, brighter on hover.
public struct SecondaryButtonStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    SecondaryButton(label: configuration.label, pressed: configuration.isPressed).clickable()
  }
}

private struct SecondaryButton<Label: View>: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label
  let pressed: Bool
  @State private var hovering = false

  var body: some View {
    label
      .font(.scaled(size: 12, weight: .medium))
      .lineLimit(1)
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
      .foregroundStyle(isEnabled ? theme.text : theme.textMuted)
      .background(fill, in: .rect(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.border))
      .contentShape(.rect(cornerRadius: 6))
      .onHover { hovering = $0 }
  }

  private var fill: Color {
    guard isEnabled else { return theme.surface }
    if pressed { return theme.borderStrong }
    return hovering ? theme.bgHover : theme.selection
  }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
  public static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

extension ButtonStyle where Self == AccentButtonStyle {
  public static var accent: AccentButtonStyle { AccentButtonStyle() }
}

// MARK: - Field

extension View {
  /// A borderless text field on a quiet fill, as the flat chrome draws inputs.
  public func quietField() -> some View {
    modifier(QuietField())
  }
}

private struct QuietField: ViewModifier {
  @Environment(\.theme) private var theme

  func body(content: Content) -> some View {
    content
      .textFieldStyle(.plain)
      .font(.scaled(size: 12))
      .padding(.horizontal, 7)
      .padding(.vertical, 4)
      .background(theme.selection, in: .rect(cornerRadius: 6))
  }
}

#Preview {
  @Previewable @State var amend = true
  @Previewable @State var signOff = false
  @Previewable @State var query = ""
  VStack(alignment: .leading, spacing: 12) {
    HStack(spacing: 2) {
      Button("Changes") {}.buttonStyle(QuietTabButtonStyle(selected: true))
      Button("History") {}.buttonStyle(QuietTabButtonStyle())
    }
    HStack(spacing: 10) {
      Toggle("Amend", isOn: $amend)
      Toggle("Sign Off", isOn: $signOff)
    }
    .toggleStyle(.quietCheckbox)
    HStack {
      Button("Commit") {}.buttonStyle(AccentButtonStyle())
      Button("Commit") {}.buttonStyle(AccentButtonStyle()).disabled(true)
    }
    TextField("Filter", text: $query).quietField()
    QuietEmptyState(icon: "checkmark.seal", title: "Nothing to commit", message: "Your working tree is clean.") {
      Button("Refresh") {}
    }
    .frame(height: 140)
  }
  .padding()
  .frame(width: 320)
}
