#if os(macOS)
  import SwiftUI

  /// A dropdown drawn as a floating surface below its trigger: icon rows with
  /// shortcut hints and checkmarks, grouped by headers and hairlines.

  // MARK: - Model

  public struct ChromeMenuItem {
    public enum Role {
      case normal
      case destructive
    }

    public var title: String
    public var subtitle: String?
    public var icon: ChromeIcon?
    public var shortcut: String?
    public var checked: Bool
    public var role: Role
    public var disabled: Bool
    /// A toggle that stays open so several can be flipped in one go.
    public var keepsOpen: Bool
    /// A letter that picks the row while the menu is open; shown as its hint when there's no shortcut.
    public var key: Character?
    public var action: () -> Void

    public init(
      _ title: String, subtitle: String? = nil, icon: ChromeIcon? = nil, shortcut: String? = nil,
      checked: Bool = false, role: Role = .normal, disabled: Bool = false, keepsOpen: Bool = false,
      key: Character? = nil, action: @escaping () -> Void
    ) {
      self.title = title
      self.subtitle = subtitle
      self.icon = icon
      self.shortcut = shortcut ?? key.map { String($0).uppercased() }
      self.key = key.map { Character(String($0).lowercased()) }
      self.checked = checked
      self.role = role
      self.disabled = disabled
      self.keepsOpen = keepsOpen
      self.action = action
    }
  }

  public enum ChromeMenuEntry {
    case item(ChromeMenuItem)
    case divider
    case header(String)
    /// Muted text that can't be picked, e.g. why the list is empty.
    case note(String)

    var item: ChromeMenuItem? {
      if case .item(let item) = self { item } else { nil }
    }
  }

  @resultBuilder
  public enum ChromeMenuBuilder {
    public static func buildExpression(_ item: ChromeMenuItem) -> [ChromeMenuEntry] { [.item(item)] }
    public static func buildExpression(_ entry: ChromeMenuEntry) -> [ChromeMenuEntry] { [entry] }
    public static func buildExpression(_ entries: [ChromeMenuEntry]) -> [ChromeMenuEntry] { entries }
    public static func buildBlock(_ parts: [ChromeMenuEntry]...) -> [ChromeMenuEntry] { parts.flatMap { $0 } }
    public static func buildOptional(_ part: [ChromeMenuEntry]?) -> [ChromeMenuEntry] { part ?? [] }
    public static func buildEither(first part: [ChromeMenuEntry]) -> [ChromeMenuEntry] { part }
    public static func buildEither(second part: [ChromeMenuEntry]) -> [ChromeMenuEntry] { part }
    public static func buildArray(_ parts: [[ChromeMenuEntry]]) -> [ChromeMenuEntry] { parts.flatMap { $0 } }
  }

  extension ChromeMenuEntry {
    /// Drops dividers at either end and any that follow another divider or a header.
    static func tidy(_ entries: [ChromeMenuEntry]) -> [ChromeMenuEntry] {
      var out: [ChromeMenuEntry] = []
      for entry in entries {
        if case .divider = entry {
          switch out.last {
          case .none, .divider, .header: continue
          default: break
          }
        }
        out.append(entry)
      }
      while case .divider = out.last { out.removeLast() }
      return out
    }
  }

  /// What a menu on screen shows and which row the keyboard or pointer is on.
  @MainActor @Observable
  final class ChromeMenuModel {
    var entries: [ChromeMenuEntry] = [] {
      didSet {
        if let highlighted, !selectable.contains(highlighted) { self.highlighted = nil }
      }
    }
    var highlighted: Int?

    var selectable: [Int] {
      entries.indices.filter { entries[$0].item.map { !$0.disabled } ?? false }
    }

    /// The enabled row a typed letter picks.
    func item(forKey key: Character) -> ChromeMenuItem? {
      let key = Character(String(key).lowercased())
      return entries.lazy.compactMap(\.item).first { $0.key == key && !$0.disabled }
    }

    func move(_ step: Int) {
      let rows = selectable
      guard !rows.isEmpty else { return }
      guard let current = highlighted, let at = rows.firstIndex(of: current) else {
        highlighted = step > 0 ? rows.first : rows.last
        return
      }
      highlighted = rows[(at + step + rows.count) % rows.count]
    }
  }

  // MARK: - Views

  struct ChromeMenuView: View {
    @Environment(\.theme) private var theme
    let model: ChromeMenuModel
    let minWidth: CGFloat
    /// Set when the list is taller than the room on screen.
    let scrollHeight: CGFloat?
    let pick: (ChromeMenuItem) -> Void

    var body: some View {
      Group {
        if let scrollHeight {
          ScrollViewReader { proxy in
            ScrollView { rows }
              .frame(height: scrollHeight)
              .onChange(of: model.highlighted) { _, index in
                if let index { proxy.scrollTo(index) }
              }
          }
        } else {
          rows
        }
      }
      .padding(4)
      .background(theme.surface, in: .rect(cornerRadius: 10))
      .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(theme.border, lineWidth: 1))
      .clipShape(.rect(cornerRadius: 10))
      .environment(\.colorScheme, theme.scheme)
    }

    private var rows: some View {
      let reserveIcon = model.entries.contains { $0.item?.icon != nil }
      let reserveCheck = model.entries.contains { $0.item?.checked == true }
      return VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(model.entries.enumerated()), id: \.offset) { index, entry in
          switch entry {
          case .item(let item):
            ChromeMenuRow(
              item: item, reserveIcon: reserveIcon, reserveCheck: reserveCheck,
              highlighted: model.highlighted == index
            ) { hovering in
              if hovering, !item.disabled {
                model.highlighted = index
              } else if model.highlighted == index {
                model.highlighted = nil
              }
            } pick: {
              pick(item)
            }
            .id(index)
          case .divider:
            Rectangle().fill(theme.border).frame(height: 1).padding(.vertical, 4).padding(.horizontal, 4)
          case .header(let title):
            Text(title)
              .font(.scaled(size: 11, weight: .medium))
              .foregroundStyle(theme.textMuted)
              .padding(.horizontal, 8)
              .padding(.top, index == 0 ? 3 : 6)
              .padding(.bottom, 3)
          case .note(let text):
            Text(text)
              .font(.scaled(size: 12))
              .foregroundStyle(theme.textMuted)
              .frame(maxWidth: TextScale.shared(260), alignment: .leading)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.horizontal, 8)
              .padding(.vertical, 5)
          }
        }
      }
      // At least as wide as the trigger, so every row's highlight spans the panel.
      .frame(minWidth: max(0, minWidth - 8), alignment: .leading)
      .fixedSize(horizontal: true, vertical: false)
    }
  }

  /// One pickable line: icon, title (and subtitle), then shortcut and checkmark.
  struct ChromeMenuRow: View {
    @Environment(\.theme) private var theme
    let item: ChromeMenuItem
    let reserveIcon: Bool
    let reserveCheck: Bool
    let highlighted: Bool
    let hover: (Bool) -> Void
    let pick: () -> Void

    private var tint: Color {
      item.disabled ? theme.textMuted : item.role == .destructive ? theme.error : theme.text
    }

    var body: some View {
      HStack(spacing: 8) {
        if let icon = item.icon {
          ChromeIconView(icon, tint: item.role == .destructive ? theme.error : nil)
            .opacity(item.disabled ? 0.5 : 1)
        } else if reserveIcon {
          Color.clear.frame(width: TextScale.shared(16), height: 1)
        }
        VStack(alignment: .leading, spacing: 1) {
          Text(item.title)
            .font(.scaled(size: 13))
            .foregroundStyle(tint)
            .lineLimit(1)
          if let subtitle = item.subtitle, !subtitle.isEmpty {
            Text(subtitle)
              .font(.scaled(size: 11))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 16)
        if let shortcut = item.shortcut {
          KeyHint(shortcut, size: 11, boxed: false).foregroundStyle(theme.textMuted)
        }
        if reserveCheck {
          Image(systemName: Icon.check)
            .font(.scaled(size: 11, weight: .semibold))
            .foregroundStyle(theme.text)
            .opacity(item.checked ? 1 : 0)
            .frame(width: TextScale.shared(12))
        }
      }
      .padding(.horizontal, 8)
      .padding(.vertical, item.subtitle?.isEmpty == false ? 5 : 0)
      .frame(minHeight: TextScale.shared(28))
      .background {
        if highlighted { RoundedRectangle(cornerRadius: 6).fill(theme.selection) }
      }
      .contentShape(.rect)
      .onHover(perform: hover)
      .onTapGesture { if !item.disabled { pick() } }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(item.title)
      .accessibilityAddTraits(item.checked ? [.isButton, .isSelected] : .isButton)
    }
  }
#endif
