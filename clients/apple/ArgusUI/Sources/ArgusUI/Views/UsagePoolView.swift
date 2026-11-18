import ArgusCore
import SwiftUI

/// A provider with several accounts: a card per window with what's left of the
/// pool, then one row per account that expands into its own meters.
struct UsagePoolSection: View {
  @Environment(\.theme) private var theme
  let pool: UsagePool
  let now: Date
  @State private var expanded: Set<String> = []

  var body: some View {
    HStack(spacing: 6) {
      SectionHeader(title: pool.label)
      Badge(label: "\(pool.accounts.count) accounts")
    }
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: theme.space, alignment: .top)], spacing: theme.space) {
      ForEach(pool.cards) { card in
        Card { UsagePoolCardBody(card: card, now: now) { expanded.insert($0) } }
      }
    }
    Card {
      VStack(alignment: .leading, spacing: theme.space) {
        ForEach(Array(pool.accounts.enumerated()), id: \.element.id) { index, account in
          if index > 0 { Divider().overlay(theme.borderSubtle) }
          accountRow(account)
          if expanded.contains(account.id) { UsagePoolAccountDetail(account: account, now: now) }
        }
      }
    }
  }

  private func accountRow(_ account: UsagePoolAccount) -> some View {
    let isExpanded = expanded.contains(account.id)
    return Button {
      withAnimation(.snappy(duration: 0.2)) {
        if isExpanded { expanded.remove(account.id) } else { expanded.insert(account.id) }
      }
    } label: {
      HStack(spacing: 10) {
        Image(systemName: Icon.person)
          .font(.scaled(size: 16))
          .foregroundStyle(theme.textMuted)
        Text(account.label)
          .font(.scaled(size: 13, weight: .medium))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        if let plan = account.plan, !plan.isEmpty { Badge(label: plan.capitalized) }
        Spacer(minLength: 8)
        if !isExpanded, let caption = UsageLimitFormat.resetCaption(resetsAtMs: account.sessionResetsAt, now: now) {
          Text("Session · \(caption.prefix(1).lowercased() + caption.dropFirst())")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
        }
        Image(systemName: Icon.chevronRight)
          .font(.scaled(size: 11, weight: .semibold))
          .foregroundStyle(theme.textMuted)
          .rotationEffect(.degrees(isExpanded ? 90 : 0))
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
  }
}

/// One window across the pool: what's left, a segment per account, the next reset.
private struct UsagePoolCardBody: View {
  @Environment(\.theme) private var theme
  let card: UsagePoolCard
  let now: Date
  let onSelect: (String) -> Void

  private var tone: Tone { UsageTone.of(card.level) }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(card.label)
        .font(.scaled(size: 13, weight: .medium))
        .foregroundStyle(theme.textSecondary)
      Text("\(card.percentLeft)% left")
        .font(.scaled(size: 22, weight: .semibold))
        .monospacedDigit()
        .foregroundStyle(tone == .accent ? theme.text : tone.color(theme))
      HStack(spacing: 3) {
        ForEach(card.segments) { segment in
          Button {
            withAnimation(.snappy(duration: 0.2)) { onSelect(segment.account.id) }
          } label: {
            UsagePoolSegmentBar(segment: segment)
          }
          .buttonStyle(.argusPlain)
          .help(segment.account.label)
          .accessibilityLabel(segmentLabel(segment))
        }
      }
      Text(caption)
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textMuted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var caption: String {
    let pool = "Pool of \(card.segments.filter { $0.window != nil }.count) accounts"
    guard let next = card.nextReset, let countdown = UsageLimitFormat.countdown(until: next.resetsAt, now: now) else {
      return pool
    }
    return "Next reset in \(countdown) gives back \(next.restoresPercent)% · \(next.account.label)"
  }

  private func segmentLabel(_ segment: UsagePoolSegment) -> String {
    guard let window = segment.window else { return "\(segment.account.label): not reported" }
    let left = segment.blockedByWeekly ? 0 : UsageLimitFormat.percentLeft(usedPercent: window.usedPercent)
    return "\(segment.account.label): \(left)% left"
  }
}

/// One account's part of a pooled bar: its used share filled, hatched when the
/// next reset gives it back, an outline where it doesn't report the window.
struct UsagePoolSegmentBar: View {
  @Environment(\.theme) private var theme
  let segment: UsagePoolSegment

  var body: some View {
    let tone = UsageTone.of(UsageLimitFormat.level(usedPercent: segment.usedFraction * 100))
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        if segment.window == nil {
          RoundedRectangle(cornerRadius: 3)
            .strokeBorder(theme.border, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
        } else {
          RoundedRectangle(cornerRadius: 3).fill(theme.bgHover)
          Group {
            if segment.restoresNext {
              HatchedFill(color: tone.color(theme))
            } else {
              Rectangle().fill(tone.color(theme))
            }
          }
          .frame(width: proxy.size.width * segment.usedFraction)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 3))
    }
    .frame(height: 10)
    .contentShape(Rectangle())
  }
}

/// An expanded account: each window's full meter, pace included.
struct UsagePoolAccountDetail: View {
  @Environment(\.theme) private var theme
  let account: UsagePoolAccount
  let now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: theme.space) {
      if account.weeklySpent {
        Text("No weekly quota left, so its session has nothing to give until the week resets.")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.warning)
          .fixedSize(horizontal: false, vertical: true)
      }
      ForEach(Array(account.windows.enumerated()), id: \.element.id) { index, window in
        if index > 0 { Divider().overlay(theme.borderSubtle) }
        UsageMeterRow(window: window, now: now)
      }
    }
    .padding(theme.space)
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.borderSubtle))
  }
}

enum UsageTone {
  static func of(_ level: UsageLevel) -> Tone {
    switch level {
    case .normal: .accent
    case .warning: .warning
    case .critical: .danger
    }
  }
}
