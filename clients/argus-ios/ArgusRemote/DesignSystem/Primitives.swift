import SwiftUI

enum Layout {
  /// Where a full-width control stops growing. Past this a button is just a
  /// long strip of colour, which on an iPad is most of the screen.
  static let maxControlWidth: CGFloat = 420
}

// MARK: - Typography

struct TitleText: View {
  @Environment(\.theme) private var theme
  let text: String
  init(_ text: String) { self.text = text }
  var body: some View {
    Text(text).font(.system(size: 19, weight: .bold)).foregroundStyle(theme.text)
  }
}

struct BodyText: View {
  @Environment(\.theme) private var theme
  let text: String
  var lineLimit: Int?
  init(_ text: String, lineLimit: Int? = nil) {
    self.text = text
    self.lineLimit = lineLimit
  }
  var body: some View {
    Text(text).font(.system(size: 15)).foregroundStyle(theme.text).lineLimit(lineLimit)
  }
}

struct MutedText: View {
  @Environment(\.theme) private var theme
  let text: String
  var lineLimit: Int?
  init(_ text: String, lineLimit: Int? = nil) {
    self.text = text
    self.lineLimit = lineLimit
  }
  var body: some View {
    Text(text).font(.system(size: 13)).foregroundStyle(theme.textMuted).lineLimit(lineLimit)
  }
}

struct MonoText: View {
  @Environment(\.theme) private var theme
  let text: String
  var size: CGFloat = 12
  var color: Color?
  var lineLimit: Int?
  /// Paths are truncated at the head — when one is too long, the filename is
  /// the part worth keeping.
  var truncateHead = false

  var body: some View {
    Text(text)
      .font(.system(size: size, design: .monospaced))
      .foregroundStyle(color ?? theme.textSecondary)
      .lineLimit(lineLimit)
      .truncationMode(truncateHead ? .head : .tail)
  }
}

// MARK: - Containers

/// A scrolling screen body with the standard padding and background.
struct Screen<Content: View>: View {
  @Environment(\.theme) private var theme
  var scroll = true
  @ViewBuilder var content: Content

  var body: some View {
    Group {
      if scroll {
        ScrollView {
          VStack(alignment: .leading, spacing: theme.space) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(theme.space)
        }
        .scrollDismissesKeyboard(.interactively)
      } else {
        VStack(alignment: .leading, spacing: theme.space) { content }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(theme.space)
      }
    }
    .background(theme.bg.ignoresSafeArea())
  }
}

struct Card<Content: View>: View {
  @Environment(\.theme) private var theme
  var tone: Tone?
  var onTap: (() -> Void)?
  @ViewBuilder var content: Content

  var body: some View {
    let card = VStack(alignment: .leading, spacing: 8) { content }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(theme.space)
      .background(theme.bgSecondary)
      .clipShape(RoundedRectangle(cornerRadius: theme.radius))
      .overlay(
        RoundedRectangle(cornerRadius: theme.radius)
          .stroke(tone?.color(theme).opacity(0.5) ?? theme.border, lineWidth: 1)
      )

    if let onTap {
      Button(action: onTap) { card }.buttonStyle(.plain)
    } else {
      card
    }
  }
}

struct SectionHeader: View {
  @Environment(\.theme) private var theme
  let title: String
  var count: Int?

  var body: some View {
    HStack(spacing: 6) {
      Text(title.uppercased())
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(theme.textMuted)
      if let count {
        Text("\(count)")
          .font(.system(size: 11, weight: .bold))
          .foregroundStyle(theme.textMuted.opacity(0.7))
      }
      Spacer(minLength: 0)
    }
    .padding(.top, 4)
  }
}

/// A labelled settings row with optional explanatory caption.
struct Field<Content: View>: View {
  @Environment(\.theme) private var theme
  let label: String
  var caption: String?
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(label)
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(theme.textMuted)
      content
      if let caption {
        MutedText(caption)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(theme.space)
    .background(theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radius))
    .overlay(
      RoundedRectangle(cornerRadius: theme.radius).stroke(theme.border, lineWidth: 1))
  }
}

// MARK: - Buttons

enum ButtonTone { case primary, secondary, danger, ghost }

struct Btn: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: String
  var tone: ButtonTone = .primary
  var small = false
  var icon: String?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if let icon {
          Image(systemName: icon).font(.system(size: small ? 11 : 13, weight: .semibold))
        }
        Text(label).font(.system(size: small ? 13 : 15, weight: .semibold))
      }
      .frame(maxWidth: tone == .ghost ? nil : Layout.maxControlWidth)
      .padding(.vertical, small ? 7 : 11)
      .padding(.horizontal, small ? 12 : 14)
      .foregroundStyle(foreground)
      .background(background)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      .overlay(
        RoundedRectangle(cornerRadius: theme.radiusSmall)
          .stroke(border, lineWidth: tone == .secondary ? 1 : 0))
      // Centre the capped button in whatever space it was given, rather than
      // letting it sit against the leading edge of a wide layout.
      .frame(maxWidth: tone == .ghost ? nil : .infinity, alignment: .center)
    }
    .buttonStyle(.plain)
    .opacity(isEnabled ? 1 : 0.4)
  }

  private var foreground: Color {
    switch tone {
    case .primary: theme.onAccent
    case .secondary: theme.text
    case .danger: theme.error
    case .ghost: theme.textSecondary
    }
  }

  private var background: Color {
    switch tone {
    case .primary: theme.accent
    case .secondary: theme.bgTertiary
    case .danger: theme.errorSoft
    case .ghost: .clear
    }
  }

  private var border: Color {
    tone == .secondary ? theme.border : .clear
  }
}

struct IconBtn: View {
  @Environment(\.theme) private var theme
  let systemName: String
  var label: String
  var size: CGFloat = 17
  var tint: Color?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemName)
        .font(.system(size: size, weight: .medium))
        .foregroundStyle(tint ?? theme.textSecondary)
        .frame(width: 32, height: 32)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

// MARK: - Status and labels

struct Badge: View {
  @Environment(\.theme) private var theme
  let label: String
  var tone: Tone = .muted

  var body: some View {
    Text(label)
      .font(.system(size: 11, weight: .semibold))
      .foregroundStyle(tone.color(theme))
      .padding(.horizontal, 7)
      .padding(.vertical, 3)
      .background(tone.soft(theme))
      .clipShape(Capsule())
  }
}

struct Chip: View {
  @Environment(\.theme) private var theme
  let label: String
  var icon: String?
  var tone: Tone?
  var mono = false
  var action: (() -> Void)?

  var body: some View {
    let content = HStack(spacing: 4) {
      if let icon {
        Image(systemName: icon).font(.system(size: 10, weight: .medium))
      }
      Text(label)
        .font(.system(size: 12, design: mono ? .monospaced : .default))
        .lineLimit(1)
    }
    .foregroundStyle(tone?.color(theme) ?? theme.textSecondary)
    .padding(.horizontal, 9)
    .padding(.vertical, 5)
    .background(tone?.soft(theme) ?? theme.bgTertiary)
    .clipShape(Capsule())

    if let action {
      Button(action: action) { content }.buttonStyle(.plain)
    } else {
      content
    }
  }
}

struct Banner: View {
  @Environment(\.theme) private var theme
  let text: String
  var tone: Tone = .warning

  var body: some View {
    HStack(alignment: .top, spacing: 0) {
      Rectangle().fill(tone.color(theme)).frame(width: 3)
      Text(text)
        .font(.system(size: 13))
        .foregroundStyle(theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
    }
    .background(tone.soft(theme))
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }
}

struct StatusDot: View {
  @Environment(\.theme) private var theme
  var tone: Tone
  var pulse = false
  @State private var faded = false

  var body: some View {
    Circle()
      .fill(tone.color(theme))
      .frame(width: 7, height: 7)
      .opacity(pulse && faded ? 0.3 : 1)
      .animation(
        pulse ? .easeInOut(duration: 0.7).repeatForever(autoreverses: true) : nil,
        value: faded
      )
      .onAppear { if pulse { faded = true } }
  }
}

struct EmptyState: View {
  let icon: String
  let title: String
  let body_: String

  init(icon: String, title: String, body: String) {
    self.icon = icon
    self.title = title
    self.body_ = body
  }

  var body: some View {
    ContentUnavailableView(title, systemImage: icon, description: Text(body_))
  }
}

struct Loading: View {
  @Environment(\.theme) private var theme
  let label: String

  var body: some View {
    VStack(spacing: 10) {
      ThinkingDots(size: 8, tint: theme.accent)
      Text(label)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 28)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(label)
  }
}
