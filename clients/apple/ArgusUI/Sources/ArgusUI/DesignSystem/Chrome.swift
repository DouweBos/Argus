import SwiftUI

/// The flat window chrome: icon buttons, breadcrumbs, project badges and the
/// floating context card. Separation comes from spacing and hairlines, not boxes.

// MARK: - Text helpers

public enum ChromeText {
  /// A project's badge letters: the first letters of its first two words, else its first two.
  public static func initials(_ name: String) -> String {
    let words = name.split { !$0.isLetter && !$0.isNumber }
    let letters: String
    if words.count >= 2 {
      letters = String(words[0].prefix(1)) + String(words[1].prefix(1))
    } else {
      letters = String((words.first ?? Substring(name)).prefix(2))
    }
    return letters.uppercased()
  }

  /// "now", "5m", "4h", "3d", "2w": how long ago, as tight as a list row needs.
  /// Takes epoch milliseconds, or seconds for values too small to be milliseconds.
  public static func shortAge(_ timestamp: Double, now: Date = Date()) -> String {
    let seconds = timestamp > 100_000_000_000 ? timestamp / 1000 : timestamp
    let minutes = Int(max(0, now.timeIntervalSince1970 - seconds) / 60)
    if minutes < 1 { return "now" }
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }
    let days = hours / 24
    return days < 14 ? "\(days)d" : "\(days / 7)w"
  }

  /// "29s", "5m 29s", "1h 4m": how long something took.
  public static func duration(_ seconds: Double) -> String {
    let total = Int(max(0, seconds).rounded(.down))
    if total < 60 { return "\(total)s" }
    let minutes = total / 60
    if minutes < 60 { return "\(minutes)m \(total % 60)s" }
    return "\(minutes / 60)h \(minutes % 60)m"
  }
}

// MARK: - Icon buttons

/// An icon-only button with no bezel: muted until hovered, a quiet fill when selected.
public struct FlatIconButtonStyle: ButtonStyle {
  var selected: Bool
  var size: CGFloat

  public init(selected: Bool = false, size: CGFloat = 26) {
    self.selected = selected
    self.size = size
  }

  public func makeBody(configuration: Configuration) -> some View {
    FlatIcon(label: configuration.label, pressed: configuration.isPressed, selected: selected, size: size)
  }
}

private struct FlatIcon<Label: View>: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label
  let pressed: Bool
  let selected: Bool
  let size: CGFloat
  @State private var hovering = false

  var body: some View {
    label
      .labelStyle(.iconOnly)
      .font(.scaled(size: 13))
      .frame(width: TextScale.shared(size), height: TextScale.shared(size - 2))
      .foregroundStyle(
        !isEnabled ? theme.textMuted : (selected || hovering ? theme.text : theme.textSecondary))
      .background {
        if isEnabled && (selected || hovering || pressed) {
          RoundedRectangle(cornerRadius: 6).fill(pressed ? theme.bgHover : theme.selection)
        }
      }
      .contentShape(.rect(cornerRadius: 6))
      .onHover { hovering = $0 }
  }
}

// MARK: - Project badge

/// A project's initials in a small rounded square, for rows and breadcrumbs.
public struct ProjectBadge: View {
  @Environment(\.theme) private var theme
  let name: String
  /// The project's path, which picks its colour; without one the badge stays neutral.
  var key: String?
  var size: CGFloat

  public init(_ name: String, key: String? = nil, size: CGFloat = 16) {
    self.name = name
    self.key = key
    self.size = size
  }

  public var body: some View {
    let tint = key.map(ProjectAccent.color(for:))
    Text(ChromeText.initials(name))
      .font(.scaled(size: size * 0.5, weight: .semibold))
      .foregroundStyle(tint ?? theme.textSecondary)
      .frame(width: TextScale.shared(size), height: TextScale.shared(size))
      .background(tint.map { $0.opacity(0.2) } ?? theme.selection, in: .rect(cornerRadius: 4))
      .accessibilityHidden(true)
  }
}

// MARK: - Breadcrumb

/// "Project / Session": the trail to what's on screen; earlier steps can be clickable.
public struct Breadcrumb: View {
  public struct Step: Identifiable {
    public var id: Int
    public var title: String
    public var badge: String?
    /// The project's path, to colour the badge.
    public var badgeKey: String?
    public var help: String?
    public var action: (() -> Void)?

    public init(
      id: Int, title: String, badge: String? = nil, badgeKey: String? = nil, help: String? = nil,
      action: (() -> Void)? = nil
    ) {
      self.id = id
      self.title = title
      self.badge = badge
      self.badgeKey = badgeKey
      self.help = help
      self.action = action
    }
  }

  @Environment(\.theme) private var theme
  let steps: [Step]

  public init(_ steps: [Step]) {
    self.steps = steps
  }

  public var body: some View {
    HStack(spacing: 6) {
      ForEach(steps) { step in
        if step.id != steps.first?.id {
          Text("/").foregroundStyle(theme.textMuted)
        }
        let last = step.id == steps.last?.id
        let label = HStack(spacing: 5) {
          if let badge = step.badge { ProjectBadge(badge, key: step.badgeKey, size: 14) }
          Text(step.title)
            .lineLimit(1)
            .truncationMode(.tail)
            .fontWeight(last ? .medium : .regular)
            .foregroundStyle(last ? theme.text : theme.textSecondary)
        }
        if let action = step.action {
          Button(action: action) { label.contentShape(.rect) }
            .buttonStyle(.plain)
            .help(step.help ?? step.title)
            .layoutPriority(last ? 0 : 1)
        } else {
          label.help(step.help ?? step.title).layoutPriority(last ? 0 : 1)
        }
      }
    }
    .font(.scaled(size: 13))
  }
}

// MARK: - Search field

/// A borderless search field for the top of a sidebar.
public struct ChromeSearchField: View {
  @Environment(\.theme) private var theme
  let placeholder: String
  @Binding var text: String

  public init(_ placeholder: String = "Search", text: Binding<String>) {
    self.placeholder = placeholder
    self._text = text
  }

  public var body: some View {
    HStack(spacing: 6) {
      Image(systemName: Icon.search)
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textMuted)
      TextField(placeholder, text: $text)
        .textFieldStyle(.plain)
        .font(.scaled(size: 13))
      if !text.isEmpty {
        Button {
          text = ""
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(theme.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, 6)
    .padding(.vertical, 4)
  }
}

// MARK: - Icons

/// What leads a row: an SF Symbol, an image such as an app's icon, or a project's badge.
public enum ChromeIcon {
  case symbol(String)
  case image(Image)
  /// A project's initials; `key` is its path, for its colour.
  case badge(String, key: String? = nil)
}

public struct ChromeIconView: View {
  @Environment(\.theme) private var theme
  let icon: ChromeIcon
  var tint: Color?

  public init(_ icon: ChromeIcon, tint: Color? = nil) {
    self.icon = icon
    self.tint = tint
  }

  public var body: some View {
    Group {
      switch icon {
      case .symbol(let name):
        Image(systemName: name)
          .font(.scaled(size: 11))
          .foregroundStyle(tint ?? theme.textSecondary)
      case .image(let image):
        image
          .resizable()
          .interpolation(.high)
          .aspectRatio(contentMode: .fit)
          .frame(width: TextScale.shared(16), height: TextScale.shared(16))
      case .badge(let name, let key):
        ProjectBadge(name, key: key, size: 15)
      }
    }
    .frame(width: TextScale.shared(16))
    .accessibilityHidden(true)
  }
}

// MARK: - Context card

/// A small floating card of facts and actions about what's on screen.
public struct ContextCard<Content: View>: View {
  @Environment(\.theme) private var theme
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) { content }
      .padding(5)
      .frame(width: TextScale.shared(236))
      .background(theme.surface, in: .rect(cornerRadius: theme.radius))
      .overlay(RoundedRectangle(cornerRadius: theme.radius).stroke(theme.border, lineWidth: 1))
      .shadow(color: .black.opacity(theme.scheme == .dark ? 0.35 : 0.08), radius: 12, y: 4)
  }
}

/// One line of a context card: icon, title, and whatever sits on the right.
public struct ContextCardRow<Trailing: View>: View {
  @Environment(\.theme) private var theme
  let icon: ChromeIcon
  let title: String
  var muted: Bool
  let trailing: Trailing

  public init(icon: ChromeIcon, title: String, muted: Bool = false, @ViewBuilder trailing: () -> Trailing) {
    self.icon = icon
    self.title = title
    self.muted = muted
    self.trailing = trailing()
  }

  public init(icon: String, title: String, muted: Bool = false, @ViewBuilder trailing: () -> Trailing) {
    self.init(icon: .symbol(icon), title: title, muted: muted, trailing: trailing)
  }

  public var body: some View {
    HStack(spacing: 8) {
      ChromeIconView(icon)
      Text(title)
        .font(.scaled(size: 12))
        .foregroundStyle(muted ? theme.textSecondary : theme.text)
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer(minLength: 4)
      trailing
    }
    .padding(.horizontal, 7)
    .frame(height: TextScale.shared(26))
    .contentShape(.rect)
  }
}

extension ContextCardRow where Trailing == EmptyView {
  public init(icon: String, title: String, muted: Bool = false) {
    self.init(icon: .symbol(icon), title: title, muted: muted) { EmptyView() }
  }

  public init(icon: ChromeIcon, title: String, muted: Bool = false) {
    self.init(icon: icon, title: title, muted: muted) { EmptyView() }
  }
}

/// A context card row as a button: highlighted on hover, and while its dropdown is open.
public struct ContextRowButtonStyle: ButtonStyle {
  var selected: Bool

  public init(selected: Bool = false) {
    self.selected = selected
  }

  public func makeBody(configuration: Configuration) -> some View {
    ContextRowHighlight(label: configuration.label, pressed: configuration.isPressed, selected: selected)
  }
}

private struct ContextRowHighlight<Label: View>: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label
  let pressed: Bool
  let selected: Bool
  @State private var hovering = false

  var body: some View {
    label
      .opacity(isEnabled ? 1 : 0.5)
      .background {
        if isEnabled && (hovering || pressed || selected) {
          RoundedRectangle(cornerRadius: 7).fill(pressed ? theme.bgHover : theme.selection)
        }
      }
      .onHover { hovering = $0 }
  }
}

/// The hairline between a context card's groups.
public struct ContextCardDivider: View {
  @Environment(\.theme) private var theme
  public init() {}

  public var body: some View {
    Rectangle().fill(theme.border).frame(height: 1).padding(.vertical, 4).padding(.horizontal, 2)
  }
}

/// "+12 −3": lines added and removed.
public struct ChangeCounts: View {
  @Environment(\.theme) private var theme
  let additions: Int
  let deletions: Int

  public init(additions: Int, deletions: Int) {
    self.additions = additions
    self.deletions = deletions
  }

  public var body: some View {
    HStack(spacing: 4) {
      Text("+\(additions.formatted())").foregroundStyle(theme.success)
      Text("−\(deletions.formatted())").foregroundStyle(theme.error)
    }
    .font(.scaled(size: 11, design: .monospaced))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(additions) lines added, \(deletions) removed")
  }
}

#Preview {
  VStack(alignment: .leading, spacing: 16) {
    Breadcrumb([
      .init(id: 0, title: "Argus", badge: "Argus", action: {}),
      .init(id: 1, title: "Unify the start composer"),
    ])
    HStack(spacing: 2) {
      Button {} label: { Label("Settings", systemImage: Icon.gear) }.buttonStyle(FlatIconButtonStyle())
      Button {} label: { Label("Home", systemImage: Icon.home) }.buttonStyle(FlatIconButtonStyle(selected: true))
    }
    ContextCard {
      ContextCardRow(icon: Icon.desktop, title: "This Mac")
      Button {} label: { ContextCardRow(icon: Icon.openExternal, title: "Open in VS Code") }
        .buttonStyle(ContextRowButtonStyle())
      ContextCardDivider()
      ContextCardRow(icon: Icon.branch, title: "feat/unified-start-composer")
      ContextCardRow(icon: Icon.file, title: "Changes") { ChangeCounts(additions: 10804, deletions: 3280) }
    }
  }
  .padding()
}
