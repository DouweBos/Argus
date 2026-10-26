import SwiftUI

/// A floating command panel: a search field on top, grouped results, and a
/// legend of the keys that drive it along the foot.
public struct CommandPanel<Field: View, Content: View>: View {
  @Environment(\.theme) private var theme
  let width: CGFloat
  let legend: [KeyLegend.Item]
  let field: Field
  let content: Content

  public init(
    width: CGFloat = 600, legend: [KeyLegend.Item] = KeyLegend.standard,
    @ViewBuilder field: () -> Field, @ViewBuilder content: () -> Content
  ) {
    self.width = width
    self.legend = legend
    self.field = field()
    self.content = content()
  }

  public var body: some View {
    VStack(spacing: 0) {
      field
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
      content
      if !legend.isEmpty {
        Rectangle().fill(theme.border).frame(height: 1)
        KeyLegend(legend)
          .padding(.horizontal, 12)
          .padding(.vertical, 7)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .frame(width: TextScale.shared(width))
    .background(theme.surface, in: .rect(cornerRadius: theme.radius))
    .overlay(RoundedRectangle(cornerRadius: theme.radius).strokeBorder(theme.border))
    .clipShape(.rect(cornerRadius: theme.radius))
    .shadow(color: .black.opacity(theme.scheme == .dark ? 0.45 : 0.14), radius: 24, y: 10)
  }
}

/// The panel's search line: a magnifier and a borderless field.
public struct CommandPanelField: View {
  @Environment(\.theme) private var theme
  let placeholder: String
  @Binding var text: String
  var focus: FocusState<Bool>.Binding

  public init(_ placeholder: String, text: Binding<String>, focus: FocusState<Bool>.Binding) {
    self.placeholder = placeholder
    self._text = text
    self.focus = focus
  }

  public var body: some View {
    HStack(spacing: 8) {
      Image(systemName: Icon.search)
        .font(.scaled(size: 13))
        .foregroundStyle(theme.textMuted)
      TextField(placeholder, text: $text)
        .textFieldStyle(.plain)
        .font(.scaled(size: 14))
        .focused(focus)
    }
  }
}

/// A small muted label over a run of results.
public struct CommandPanelHeader: View {
  @Environment(\.theme) private var theme
  let title: String

  public init(_ title: String) {
    self.title = title
  }

  public var body: some View {
    Text(title)
      .font(.scaled(size: 11, weight: .medium))
      .foregroundStyle(theme.textMuted)
      .padding(.horizontal, 10)
      .padding(.top, 8)
      .padding(.bottom, 3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }
}

/// One result: icon, title (and a secondary line), its shortcut on the right.
public struct CommandPanelRow: View {
  @Environment(\.theme) private var theme
  let systemImage: String
  let title: String
  let subtitle: String?
  let shortcut: String?
  let selected: Bool
  @State private var hovering = false

  public init(systemImage: String, title: String, subtitle: String? = nil, shortcut: String? = nil, selected: Bool) {
    self.systemImage = systemImage
    self.title = title
    self.subtitle = subtitle
    self.shortcut = shortcut
    self.selected = selected
  }

  public var body: some View {
    HStack(spacing: 10) {
      Image(systemName: systemImage)
        .font(.scaled(size: 12))
        .foregroundStyle(selected ? theme.text : theme.textSecondary)
        .frame(width: TextScale.shared(16))
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        if let subtitle {
          Text(subtitle)
            .font(.scaled(size: 11))
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }
      Spacer(minLength: 8)
      if let shortcut {
        KeyHint(shortcut, size: 10.5, boxed: false).foregroundStyle(theme.textMuted)
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, subtitle == nil ? 6 : 4)
    .background {
      if selected || hovering {
        RoundedRectangle(cornerRadius: 7).fill(selected ? theme.selection : theme.selection.opacity(0.5))
      }
    }
    .contentShape(.rect(cornerRadius: 7))
    .onHover { hovering = $0 }
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// "↑ ↓ Navigate · Enter Select · Esc Close": each key in a small cap, then what it does.
public struct KeyLegend: View {
  public struct Item: Hashable, Sendable {
    public var keys: [String]
    public var label: String

    public init(_ keys: [String], _ label: String) {
      self.keys = keys
      self.label = label
    }
  }

  public static let standard: [Item] = [.init(["↑", "↓"], "Navigate"), .init(["Enter"], "Select"), .init(["Esc"], "Close")]

  @Environment(\.theme) private var theme
  let items: [Item]

  public init(_ items: [Item]) {
    self.items = items
  }

  public var body: some View {
    HStack(spacing: 14) {
      ForEach(items, id: \.self) { item in
        HStack(spacing: 5) {
          ForEach(item.keys, id: \.self) { key in
            Text(key)
              .font(.scaled(size: 10, weight: .medium))
              .foregroundStyle(theme.textSecondary)
              .padding(.horizontal, 4)
              .frame(minWidth: TextScale.shared(16), minHeight: TextScale.shared(16))
              .background(theme.selection, in: .rect(cornerRadius: 4))
          }
          Text(item.label)
            .font(.scaled(size: 11))
            .foregroundStyle(theme.textMuted)
        }
        .accessibilityElement(children: .combine)
      }
    }
  }
}

#Preview {
  @Previewable @State var text = ""
  @Previewable @FocusState var focused: Bool
  CommandPanel {
    CommandPanelField("Search commands, projects and sessions…", text: $text, focus: $focused)
  } content: {
    VStack(spacing: 0) {
      CommandPanelHeader("Actions")
      CommandPanelRow(systemImage: "plus", title: "New Session…", shortcut: "⌘N", selected: true)
      CommandPanelRow(systemImage: "folder.badge.plus", title: "Add Project…", shortcut: "⌘O", selected: false)
      CommandPanelHeader("Sessions")
      CommandPanelRow(
        systemImage: "arrow.triangle.branch", title: "Unify the start composer", subtitle: "Argus", selected: false)
    }
    .padding(.horizontal, 6)
    .padding(.bottom, 6)
  }
  .padding(40)
}
