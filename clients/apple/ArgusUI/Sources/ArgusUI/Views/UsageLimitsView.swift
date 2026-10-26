import ArgusCore
import SwiftUI

/// Claude plan limits for every account on the host, kept fresh while shown:
/// polled every minute, while a pull or Retry skips the host's cache.
public struct HostUsageLimitsView: View {
  @Environment(HostStore.self) private var host

  public init() {}

  public var body: some View {
    UsageLimitsView(
      limits: host.usageLimits, error: host.usageLimitsError, loading: host.usageLimitsLoading
    ) {
      Task { await host.loadUsageLimits(refresh: true) }
    }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(60)) {
      await host.loadUsageLimits()
    }
    .refreshable { await host.loadUsageLimits(refresh: true) }
  }
}

/// Plan limits grouped per account; the account is only named when there is
/// more than one, since a lone header just repeats the screen title.
public struct UsageLimitsView: View {
  @Environment(\.theme) private var theme
  let limits: ArgusProtocol.ClaudeUsageLimits?
  let error: String?
  let loading: Bool
  let onRetry: () -> Void

  public init(
    limits: ArgusProtocol.ClaudeUsageLimits?, error: String?, loading: Bool,
    onRetry: @escaping () -> Void
  ) {
    self.limits = limits
    self.error = error
    self.loading = loading
    self.onRetry = onRetry
  }

  public var body: some View {
    if let limits {
      if limits.accounts.isEmpty {
        EmptyState(
          icon: Icon.person, title: "No Claude accounts",
          body: "Sign in to Claude on the computer to see plan limits.")
      } else {
        content(limits)
      }
    } else if let error {
      EmptyState(icon: Icon.warning, title: "Couldn't load plan limits", body: error, selectable: true) {
        Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh, action: onRetry)
          .fixedSize()
          .disabled(loading)
      }
    } else {
      Loading(label: "Checking plan limits…")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func content(_ limits: ArgusProtocol.ClaudeUsageLimits) -> some View {
    // The countdowns move while the screen sits open.
    TimelineView(.periodic(from: .now, by: 30)) { context in
      Screen {
        if let error {
          Banner(text: error, tone: .danger, actionLabel: "Retry", action: onRetry)
        }
        ForEach(limits.accounts, id: \.accountId) { account in
          if limits.accounts.count > 1 {
            HStack(spacing: 6) {
              SectionHeader(title: account.label)
              if let plan = account.subscriptionType, !plan.isEmpty {
                Badge(label: plan.capitalized)
              }
            }
          }
          Card { AccountLimits(account: account, now: context.date, onRetry: onRetry) }
        }
        if let checked = limits.accounts.map(\.checkedAt).max(), checked > 0 {
          Text("Checked \(Date(timeIntervalSince1970: checked / 1000), style: .relative) ago")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
        }
      }
    }
  }
}

private struct AccountLimits: View {
  @Environment(\.theme) private var theme
  let account: ArgusProtocol.ClaudeAccountLimits
  let now: Date
  let onRetry: () -> Void

  var body: some View {
    switch account.status {
    case .ok where !account.windows.isEmpty:
      VStack(alignment: .leading, spacing: theme.space) {
        ForEach(Array(account.windows.enumerated()), id: \.element.id) { index, window in
          if index > 0 { Divider().overlay(theme.borderSubtle) }
          UsageMeterRow(window: window, now: now)
        }
      }
    case .failed:
      HStack(spacing: theme.space) {
        Text("Couldn't read this account's limits.")
          .font(.scaled(size: 13))
          .foregroundStyle(theme.error)
          .frame(maxWidth: .infinity, alignment: .leading)
        Btn(label: "Retry", tone: .secondary, small: true, action: onRetry).fixedSize()
      }
    default:
      MutedText("No plan limits for this account")
    }
  }
}

/// One plan window: what is left, a bar, when it resets and how the pace looks.
public struct UsageMeterRow: View {
  @Environment(\.theme) private var theme
  let window: ArgusProtocol.UsageLimitWindow
  let now: Date

  public init(window: ArgusProtocol.UsageLimitWindow, now: Date) {
    self.window = window
    self.now = now
  }

  private var tone: Tone {
    switch UsageLimitFormat.level(usedPercent: window.usedPercent) {
    case .normal: .accent
    case .warning: .warning
    case .critical: .danger
    }
  }

  public var body: some View {
    let left = UsageLimitFormat.percentLeft(usedPercent: window.usedPercent)
    let reset = UsageLimitFormat.resetCaption(resetsAtMs: window.resetsAt, now: now)
    let pace = UsageLimitFormat.paceCaption(window.pace)
    VStack(alignment: .leading, spacing: 6) {
      Text(window.label)
        .font(.scaled(size: 13, weight: .medium))
        .foregroundStyle(theme.textSecondary)
      Text("\(left)% left")
        .font(.scaled(size: 22, weight: .semibold))
        .monospacedDigit()
        .foregroundStyle(tone == .accent ? theme.text : tone.color(theme))
      UsageBar(fraction: UsageLimitFormat.fraction(usedPercent: window.usedPercent), tone: tone)
      if reset != nil || pace != nil {
        HStack(spacing: 8) {
          if let reset { Text(reset) }
          Spacer(minLength: 0)
          if let pace { Text(pace) }
        }
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textMuted)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// A rounded fill bar; the track is the theme's hover tint.
struct UsageBar: View {
  @Environment(\.theme) private var theme
  let fraction: Double
  let tone: Tone

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(theme.bgHover)
        Capsule()
          .fill(tone.color(theme))
          .frame(width: proxy.size.width * fraction)
      }
    }
    .frame(height: 6)
    .accessibilityHidden(true)
  }
}
