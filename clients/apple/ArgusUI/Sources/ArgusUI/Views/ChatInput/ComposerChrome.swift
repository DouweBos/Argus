#if os(macOS)
  import SwiftUI

  /// A composer setting as an inline pill: icon, value and a chevron, quiet until hovered.
  public struct ComposerPillLabel: View {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    let icon: String
    var title: String?
    var accent = false
    var chevron = true
    /// Shows the chevron only on hover or while open, keeping its space so the title doesn't shift.
    var chevronOnHover = false
    /// Its dropdown is showing.
    var open = false
    @State private var hovering = false

    public init(
      icon: String, title: String? = nil, accent: Bool = false, chevron: Bool = true, chevronOnHover: Bool = false,
      open: Bool = false
    ) {
      self.icon = icon
      self.title = title
      self.accent = accent
      self.chevron = chevron
      self.chevronOnHover = chevronOnHover
      self.open = open
    }

    public var body: some View {
      HStack(spacing: 5) {
        Image(systemName: icon).font(.scaled(size: 11))
        if let title {
          Text(title).font(.scaled(size: 12)).lineLimit(1)
        }
        if chevron {
          Image(systemName: Icon.chevronDown).font(.scaled(size: 8, weight: .semibold))
            .opacity(!chevronOnHover || ((hovering || open) && isEnabled) ? 1 : 0)
        }
      }
      .foregroundStyle(
        !isEnabled ? theme.textMuted : accent ? theme.accent : hovering || open ? theme.text : theme.textSecondary)
      .padding(.horizontal, 7)
      .frame(height: TextScale.shared(24))
      .background {
        if (hovering || open) && isEnabled { RoundedRectangle(cornerRadius: 6).fill(theme.selection) }
      }
      .contentShape(.rect(cornerRadius: 6))
      .onHover { hovering = $0 }
    }
  }

  /// The hairline between two pills.
  struct ComposerPillDivider: View {
    @Environment(\.theme) private var theme

    var body: some View {
      Rectangle().fill(theme.border).frame(width: 1, height: 12)
    }
  }

  /// The composer's round send and stop buttons.
  struct ComposerRoundButton: View {
    enum Kind {
      case send
      case stop
    }

    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    let kind: Kind
    let label: String
    let action: () -> Void

    var body: some View {
      Button(action: action) {
        Image(systemName: kind == .send ? "arrow.up" : "stop.fill")
          .font(.scaled(size: kind == .send ? 12 : 9, weight: .bold))
          .foregroundStyle(foreground)
          .frame(width: TextScale.shared(26), height: TextScale.shared(26))
          .background(kind == .send && isEnabled ? theme.accent : theme.bgHover, in: Circle())
          .overlay(Circle().strokeBorder(isEnabled ? .clear : theme.border, lineWidth: 1))
          .contentShape(Circle())
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel(label)
    }

    /// Disabled drops to a solid muted fill; fading the accent left it unreadable on dark backgrounds.
    private var foreground: Color {
      guard isEnabled else { return theme.textMuted }
      return kind == .send ? theme.onAccent : theme.text
    }
  }
#endif
