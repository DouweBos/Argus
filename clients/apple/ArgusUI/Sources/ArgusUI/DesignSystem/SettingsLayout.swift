import SwiftUI

/// A settings screen: a centred column of groups, each a muted header over one
/// rounded surface whose rows are split by hairlines. Rows put their title and
/// description on the left and the control on the right.
public enum SettingsLayout {
  /// The content column's width at most.
  public static let columnWidth: CGFloat = 720
  static let rowPadding = EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14)
}

// MARK: - Page

/// The scrolling column every settings section sits in.
public struct SettingsPage<Content: View>: View {
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) { content }
        .frame(maxWidth: SettingsLayout.columnWidth, alignment: .leading)
        .padding(.horizontal, 28)
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
    }
    .scrollContentBackground(.hidden)
  }
}

// MARK: - Group

/// A titled group of rows on one surface. Every child becomes a padded row,
/// so plain text, a loading line or a custom view each sit like a setting.
public struct SettingsGroup<Content: View, Accessory: View>: View {
  @Environment(\.theme) private var theme
  let title: String?
  let footer: String?
  let accessory: Accessory
  let content: Content

  public init(
    _ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content,
    @ViewBuilder accessory: () -> Accessory
  ) {
    self.title = title
    self.footer = footer
    self.content = content()
    self.accessory = accessory()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if title != nil || Accessory.self != EmptyView.self {
        HStack(spacing: 8) {
          if let title { SettingsGroupTitle(title, inset: false) }
          Spacer(minLength: 0)
          accessory
        }
        .padding(.horizontal, 12)
      }
      Group(subviews: content) { rows in
        if !rows.isEmpty {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
              if row.id != rows.first?.id {
                SettingsHairline()
              }
              row
                .padding(SettingsLayout.rowPadding)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
          }
          .background(theme.surface, in: .rect(cornerRadius: theme.radiusSmall + 2))
          .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall + 2).strokeBorder(theme.border))
        }
      }
      if let footer {
        Text(footer)
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 12)
      }
    }
  }
}

extension SettingsGroup where Accessory == EmptyView {
  public init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
    self.init(title, footer: footer, content: content) { EmptyView() }
  }
}

/// A group's small muted header, for a group that isn't rows (cards, a grid).
public struct SettingsGroupTitle: View {
  @Environment(\.theme) private var theme
  let title: String
  let inset: Bool

  public init(_ title: String, inset: Bool = true) {
    self.title = title
    self.inset = inset
  }

  public var body: some View {
    Text(title)
      .font(.scaled(size: 12, weight: .medium))
      .foregroundStyle(theme.textSecondary)
      .padding(.horizontal, inset ? 12 : 0)
      .accessibilityAddTraits(.isHeader)
  }
}

/// A small action beside a group's header, like "Add App…".
public struct SettingsHeaderButton: View {
  @Environment(\.theme) private var theme
  let title: String
  let systemImage: String?
  let action: () -> Void

  public init(_ title: String, systemImage: String? = nil, action: @escaping () -> Void) {
    self.title = title
    self.systemImage = systemImage
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 4) {
        if let systemImage { Image(systemName: systemImage).font(.scaled(size: 10, weight: .semibold)) }
        Text(title).font(.scaled(size: 11.5))
      }
      .foregroundStyle(theme.textSecondary)
      .padding(.horizontal, 7)
      .padding(.vertical, 3)
      .background(theme.surface, in: .rect(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.border))
      .contentShape(.rect(cornerRadius: 6))
    }
    .buttonStyle(.argusPlain)
  }
}

/// The line between two rows of a group.
public struct SettingsHairline: View {
  @Environment(\.theme) private var theme
  public init() {}

  public var body: some View {
    Rectangle().fill(theme.borderSubtle).frame(height: 1)
  }
}

// MARK: - Row

/// One setting: title and a muted description on the left, its control on the
/// right. `stacked` puts a wide control (a path, a list) under the text instead.
public struct SettingsRow<Control: View, Detail: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  let description: String?
  let stacked: Bool
  let control: Control
  let detail: Detail

  public init(
    _ title: String, description: String? = nil, stacked: Bool = false,
    @ViewBuilder control: () -> Control, @ViewBuilder detail: () -> Detail
  ) {
    self.title = title
    self.description = description
    self.stacked = stacked
    self.control = control()
    self.detail = detail()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if stacked {
        label
        control.labelsHidden().frame(maxWidth: .infinity, alignment: .leading)
      } else {
        HStack(alignment: .center, spacing: 16) {
          label.frame(minWidth: 160, maxWidth: .infinity, alignment: .leading)
          control.labelsHidden().fixedSize()
        }
      }
      detail
    }
  }

  private var label: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title)
        .font(.scaled(size: 13, weight: .medium))
        .foregroundStyle(theme.text)
      if let description, !description.isEmpty {
        Text(description)
          .font(.scaled(size: 11.5))
          .foregroundStyle(theme.textSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

extension SettingsRow where Detail == EmptyView {
  public init(
    _ title: String, description: String? = nil, stacked: Bool = false, @ViewBuilder control: () -> Control
  ) {
    self.init(title, description: description, stacked: stacked, control: control) { EmptyView() }
  }
}

extension SettingsRow where Control == EmptyView, Detail == EmptyView {
  /// A row that only says something, like a read-only fact.
  public init(_ title: String, description: String? = nil) {
    self.init(title, description: description, control: { EmptyView() }) { EmptyView() }
  }
}

/// A setting that's on or off, drawn as a small switch.
public struct SettingsToggleRow: View {
  let title: String
  let description: String?
  @Binding var isOn: Bool

  public init(_ title: String, description: String? = nil, isOn: Binding<Bool>) {
    self.title = title
    self.description = description
    self._isOn = isOn
  }

  public var body: some View {
    SettingsRow(title, description: description) {
      Toggle(title, isOn: $isOn)
        .toggleStyle(.switch)
        .controlSize(.small)
    }
  }
}

// MARK: - Navigation

/// A section in a settings window's left list: icon and label, a quiet fill when selected.
public struct SettingsNavItem: View {
  @Environment(\.theme) private var theme
  let title: String
  let systemImage: String
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  public init(_ title: String, systemImage: String, selected: Bool, action: @escaping () -> Void) {
    self.title = title
    self.systemImage = systemImage
    self.selected = selected
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 9) {
        Image(systemName: systemImage)
          .font(.scaled(size: 12))
          .foregroundStyle(selected ? theme.text : theme.textSecondary)
          .frame(width: TextScale.shared(16))
        Text(title)
          .font(.scaled(size: 13))
          .foregroundStyle(selected ? theme.text : theme.textSecondary)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 8)
      .frame(height: TextScale.shared(28))
      .background {
        if selected || hovering {
          RoundedRectangle(cornerRadius: 6).fill(selected ? theme.selection : theme.bgHover.opacity(0.6))
        }
      }
      .contentShape(.rect(cornerRadius: 6))
    }
    .buttonStyle(.argusPlain)
    .onHover { hovering = $0 }
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

#Preview {
  SettingsPage {
    SettingsGroup("New sessions", footer: "Both can be overridden per session.") {
      SettingsRow("Default model", description: "Pre-selected in the launcher.") {
        Picker("Default model", selection: .constant("opus")) {
          Text("Opus").tag("opus")
          Text("Sonnet").tag("sonnet")
        }
      }
      SettingsToggleRow("Wrap lines", description: "Soft-wrap long lines in the code view.", isOn: .constant(true))
      Text("No custom apps yet.").foregroundStyle(.secondary)
    }
  }
  .frame(width: 760, height: 360)
}
