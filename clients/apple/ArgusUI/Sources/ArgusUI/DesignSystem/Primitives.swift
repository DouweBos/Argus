import SwiftUI

public enum Layout {
  /// Where a full-width control stops growing. Past this a button is just a
  /// long strip of colour, which on an iPad is most of the screen.
  public static let maxControlWidth: CGFloat = 420
}

// MARK: - Typography

public struct TitleText: View {
  @Environment(\.theme) private var theme
  let text: String
  public init(_ text: String) { self.text = text }
  public var body: some View {
    Text(text).font(.scaled(size: 19, weight: .bold)).foregroundStyle(theme.text)
  }
}

public struct BodyText: View {
  @Environment(\.theme) private var theme
  let text: String
  var lineLimit: Int?
  public init(_ text: String, lineLimit: Int? = nil) {
    self.text = text
    self.lineLimit = lineLimit
  }
  public var body: some View {
    Text(text).font(.scaled(size: 15)).foregroundStyle(theme.text).lineLimit(lineLimit)
  }
}

public struct MutedText: View {
  @Environment(\.theme) private var theme
  let text: String
  var lineLimit: Int?
  public init(_ text: String, lineLimit: Int? = nil) {
    self.text = text
    self.lineLimit = lineLimit
  }
  public var body: some View {
    Text(text).font(.scaled(size: 13)).foregroundStyle(theme.textMuted).lineLimit(lineLimit)
  }
}

public struct MonoText: View {
  @Environment(\.theme) private var theme
  let text: String
  var size: CGFloat = 12
  var color: Color?
  var lineLimit: Int?
  /// Paths are truncated at the head — when one is too long, the filename is
  /// the part worth keeping.
  var truncateHead = false

  public init(
    text: String,
    size: CGFloat = 12,
    color: Color? = nil,
    lineLimit: Int? = nil,
    truncateHead: Bool = false
  ) {
    self.text = text
    self.size = size
    self.color = color
    self.lineLimit = lineLimit
    self.truncateHead = truncateHead
  }

  public var body: some View {
    Text(text)
      .font(.scaled(size: size, design: .monospaced))
      .foregroundStyle(color ?? theme.textSecondary)
      .lineLimit(lineLimit)
      .truncationMode(truncateHead ? .head : .tail)
  }
}

// MARK: - Containers

/// A scrolling screen body with the standard padding and background.
public struct Screen<Content: View>: View {
  @Environment(\.theme) private var theme
  var scroll = true
  @ViewBuilder var content: Content

  public init(scroll: Bool = true, @ViewBuilder content: () -> Content) {
    self.scroll = scroll
    self.content = content()
  }

  public var body: some View {
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

public struct Card<Content: View>: View {
  @Environment(\.theme) private var theme
  var tone: Tone?
  var onTap: (() -> Void)?
  @ViewBuilder var content: Content

  public init(tone: Tone? = nil, onTap: (() -> Void)? = nil, @ViewBuilder content: () -> Content) {
    self.tone = tone
    self.onTap = onTap
    self.content = content()
  }

  public var body: some View {
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

public struct SectionHeader: View {
  @Environment(\.theme) private var theme
  let title: String
  var count: Int?

  public init(title: String, count: Int? = nil) {
    self.title = title
    self.count = count
  }

  public var body: some View {
    HStack(spacing: 6) {
      Text(title.uppercased())
        .font(.scaled(size: 11, weight: .bold))
        .foregroundStyle(theme.textMuted)
      if let count {
        Text("\(count)")
          .font(.scaled(size: 11, weight: .bold))
          .foregroundStyle(theme.textMuted.opacity(0.7))
      }
      Spacer(minLength: 0)
    }
    .padding(.top, 4)
  }
}

/// A labelled settings row with optional explanatory caption.
public struct Field<Content: View>: View {
  @Environment(\.theme) private var theme
  let label: String
  var caption: String?
  @ViewBuilder var content: Content

  public init(label: String, caption: String? = nil, @ViewBuilder content: () -> Content) {
    self.label = label
    self.caption = caption
    self.content = content()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(label)
        .font(.scaled(size: 11, weight: .bold))
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

public enum ButtonTone { case primary, secondary, danger, ghost }

public struct Btn: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: String
  var tone: ButtonTone = .primary
  var small = false
  var icon: String?
  /// Sized to its label, for a row of buttons rather than a stack.
  var hugs = false
  let action: () -> Void

  public init(
    label: String,
    tone: ButtonTone = .primary,
    small: Bool = false,
    icon: String? = nil,
    hugs: Bool = false,
    action: @escaping () -> Void
  ) {
    self.label = label
    self.tone = tone
    self.small = small
    self.icon = icon
    self.hugs = hugs
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if let icon {
          Image(systemName: icon).font(.scaled(size: small ? 11 : 13, weight: .semibold))
        }
        Text(label).font(.scaled(size: small ? 13 : 15, weight: .semibold))
      }
      .frame(maxWidth: tone == .ghost || hugs ? nil : Layout.maxControlWidth)
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
      .frame(maxWidth: tone == .ghost || hugs ? nil : .infinity, alignment: .center)
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

public struct IconBtn: View {
  @Environment(\.theme) private var theme
  let systemName: String
  var label: String
  var size: CGFloat = 17
  var tint: Color?
  let action: () -> Void

  public init(
    systemName: String,
    label: String,
    size: CGFloat = 17,
    tint: Color? = nil,
    action: @escaping () -> Void
  ) {
    self.systemName = systemName
    self.label = label
    self.size = size
    self.tint = tint
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      Image(systemName: systemName)
        .font(.scaled(size: size, weight: .medium))
        .foregroundStyle(tint ?? theme.textSecondary)
        .frame(width: 32, height: 32)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

// MARK: - Status and labels

public struct Badge: View {
  @Environment(\.theme) private var theme
  let label: String
  var tone: Tone = .muted

  public init(label: String, tone: Tone = .muted) {
    self.label = label
    self.tone = tone
  }

  public var body: some View {
    Text(label)
      .font(.scaled(size: 11, weight: .semibold))
      .foregroundStyle(tone.color(theme))
      .padding(.horizontal, 7)
      .padding(.vertical, 3)
      .background(tone.soft(theme))
      .clipShape(Capsule())
  }
}

public struct Chip: View {
  @Environment(\.theme) private var theme
  let label: String
  var icon: String?
  var tone: Tone?
  var mono = false
  var action: (() -> Void)?

  public init(
    label: String,
    icon: String? = nil,
    tone: Tone? = nil,
    mono: Bool = false,
    action: (() -> Void)? = nil
  ) {
    self.label = label
    self.icon = icon
    self.tone = tone
    self.mono = mono
    self.action = action
  }

  public var body: some View {
    let content = HStack(spacing: 4) {
      if let icon {
        Image(systemName: icon).font(.scaled(size: 10, weight: .medium))
      }
      Text(label)
        .font(.scaled(size: 12, design: mono ? .monospaced : .default))
        .lineLimit(1)
    }
    .foregroundStyle(tone?.color(theme) ?? theme.textSecondary)
    .padding(.horizontal, 9)
    .padding(.vertical, 5)
    .background(tone?.soft(theme) ?? theme.bgTertiary)
    .clipShape(Capsule())

    if let action {
      Button(action: action) { content }
        .buttonStyle(.plain)
        #if os(macOS)
          .pointerStyle(.link)
        #endif
    } else {
      content
    }
  }
}

public struct Banner: View {
  @Environment(\.theme) private var theme
  let text: String
  var tone: Tone = .warning
  /// A bold lead line, for when the banner says what happened and why.
  var title: String?
  /// A trailing button, for when the banner can be acted on.
  var actionLabel: String?
  var action: (() -> Void)?

  public init(
    text: String, tone: Tone = .warning, title: String? = nil,
    actionLabel: String? = nil, action: (() -> Void)? = nil
  ) {
    self.text = text
    self.tone = tone
    self.title = title
    self.actionLabel = actionLabel
    self.action = action
  }

  public var body: some View {
    // The accent stripe is an overlay, not a row in an HStack: a bare
    // Rectangle there takes whatever height it is offered, which stretches the
    // banner to fill any container that proposes one (an overlay, say).
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 3) {
        if let title {
          Text(title).font(.scaled(size: 13, weight: .semibold)).foregroundStyle(tone.color(theme))
        }
        Text(text).font(.scaled(size: 13)).foregroundStyle(theme.text)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let actionLabel, let action {
        Btn(label: actionLabel, tone: .secondary, small: true, action: action).fixedSize()
      }
    }
    .padding(10)
    .padding(.leading, 3)
    .background(tone.soft(theme))
    .overlay(alignment: .leading) {
      Rectangle().fill(tone.color(theme)).frame(width: 3)
    }
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }
}

public struct StatusDot: View {
  @Environment(\.theme) private var theme
  var tone: Tone
  var pulse = false
  @State private var faded = false

  public init(tone: Tone, pulse: Bool = false) {
    self.tone = tone
    self.pulse = pulse
  }

  public var body: some View {
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

/// A pane with nothing to show, centred in all the room it's given. Inside a
/// scroll view or list it only gets its own height, so put it over one instead.
public struct EmptyState<Actions: View>: View {
  let icon: String
  let title: String
  let body_: String?
  /// An error worth copying: its body can be selected.
  let selectable: Bool
  let actions: Actions

  public init(
    icon: String, title: String, body: String? = nil, selectable: Bool = false,
    @ViewBuilder actions: () -> Actions
  ) {
    self.icon = icon
    self.title = title
    self.body_ = body
    self.selectable = selectable
    self.actions = actions()
  }

  public var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: icon)
    } description: {
      if let body_ {
        if selectable { Text(body_).textSelection(.enabled) } else { Text(body_) }
      }
    } actions: {
      actions
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

extension EmptyState where Actions == EmptyView {
  public init(icon: String, title: String, body: String? = nil, selectable: Bool = false) {
    self.init(icon: icon, title: title, body: body, selectable: selectable) { EmptyView() }
  }
}

public struct Loading: View {
  @Environment(\.theme) private var theme
  let label: String

  public init(label: String) {
    self.label = label
  }

  public var body: some View {
    VStack(spacing: 10) {
      ThinkingDots(size: 8, tint: theme.accent)
      Text(label)
        .font(.scaled(.subheadline))
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 28)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(label)
  }
}

// MARK: - Wrapping rows

/// Lay controls out left to right, wrapping to a new row when the next one
/// would not fit. Items in a row share its width equally, so a row of two
/// reads as two columns rather than two differently-sized buttons.
///
/// An `HStack` of buttons does the opposite: it squeezes every label until the
/// text wraps mid-word, which is how "Mark as done" became three lines on a
/// phone.
public struct FlowRow: SwiftUI.Layout {
  public var spacing: CGFloat = 8
  public var rowSpacing: CGFloat = 8

  public init(spacing: CGFloat = 8, rowSpacing: CGFloat = 8) {
    self.spacing = spacing
    self.rowSpacing = rowSpacing
  }

  public func sizeThatFits(proposal: ProposedViewSize, subviews: LayoutSubviews, cache: inout ()) -> CGSize {
    let width = proposal.replacingUnspecifiedDimensions().width
    let rows = rows(subviews, in: width)
    let height = rows.reduce(0) { $0 + rowHeight($1, subviews: subviews) }
      + rowSpacing * CGFloat(max(0, rows.count - 1))

    return CGSize(width: width, height: height)
  }

  public func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: LayoutSubviews, cache: inout ()
  ) {
    var y = bounds.minY
    for row in rows(subviews, in: bounds.width) {
      let height = rowHeight(row, subviews: subviews)
      let cells = cellWidths(row, subviews: subviews, in: bounds.width)
      var x = bounds.minX
      for (index, cell) in zip(row, cells) {
        // Centred in the cell: a control that declines to fill it — a ghost
        // button, say — should still sit on the column, not against its edge.
        subviews[index].place(
          at: CGPoint(x: x + cell / 2, y: y + height / 2), anchor: .center,
          proposal: ProposedViewSize(width: cell, height: height))
        x += cell + spacing
      }
      y += height + rowSpacing
    }
  }

  /// Equal columns, unless one would truncate a wider label the row has room
  /// for — then each gets its ideal width plus an equal share of the rest.
  private func cellWidths(_ row: [Int], subviews: LayoutSubviews, in width: CGFloat) -> [CGFloat] {
    let available = width - spacing * CGFloat(row.count - 1)
    let equal = available / CGFloat(row.count)
    let ideals = row.map { subviews[$0].sizeThatFits(.unspecified).width }
    guard ideals.contains(where: { $0 > equal }) else { return ideals.map { _ in equal } }
    let spare = max(0, available - ideals.reduce(0, +)) / CGFloat(row.count)
    return ideals.map { min($0 + spare, available) }
  }

  /// Greedy packing on each subview's ideal width — the width it wants before
  /// anything gets compressed.
  private func rows(_ subviews: LayoutSubviews, in width: CGFloat) -> [[Int]] {
    var rows: [[Int]] = []
    var current: [Int] = []
    var used: CGFloat = 0
    for index in subviews.indices {
      let ideal = subviews[index].sizeThatFits(.unspecified).width
      let needed = current.isEmpty ? ideal : used + spacing + ideal
      if !current.isEmpty, needed > width {
        rows.append(current)
        current = [index]
        used = ideal
      } else {
        current.append(index)
        used = needed
      }
    }
    if !current.isEmpty { rows.append(current) }

    return rows
  }

  private func rowHeight(_ row: [Int], subviews: LayoutSubviews) -> CGFloat {
    row.reduce(0) { max($0, subviews[$1].sizeThatFits(.unspecified).height) }
  }
}
