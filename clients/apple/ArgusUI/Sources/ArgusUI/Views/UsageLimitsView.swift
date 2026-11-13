import ArgusCore
import SwiftUI

/// Plan limits for every Claude account and runner on the host, kept fresh
/// while shown: polled every minute, while a pull or Retry skips the host's cache.
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

/// Plan limits per Claude account (pooled when there are several), then per runner. Claude's group is
/// only named alongside others, since a lone header repeats the screen title.
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
      if limits.accounts.isEmpty && (limits.runners ?? []).isEmpty {
        EmptyState(
          icon: Icon.person, title: "No plan limits",
          body: "Sign in to Claude Code, Codex or another agent on the computer to see its plan limits.")
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
    let runners = limits.runners ?? []
    let namesClaude = limits.accounts.count > 1 || !runners.isEmpty
    // The countdowns move while the screen sits open.
    return TimelineView(.periodic(from: .now, by: 30)) { context in
      Screen {
        if let error {
          Banner(text: error, tone: .danger, actionLabel: "Retry", action: onRetry)
        }
        // Several accounts pool into one card per window; the ones that failed keep their own.
        if let pool = UsagePooling.claude(limits, now: context.date) {
          UsagePoolSection(pool: pool, now: context.date)
          accounts(limits.accounts.filter { $0.status != .ok }, named: true, byName: true, now: context.date)
        } else {
          accounts(limits.accounts, named: namesClaude, byName: limits.accounts.count > 1, now: context.date)
        }
        ForEach(runners, id: \.runner) { runner in
          LimitsHeader(title: runner.label, plan: runner.plan)
          Card {
            LimitsBody(
              state: .init(runner.status), windows: runner.windows, now: context.date,
              failure: runner.message ?? "Couldn't read \(runner.label)'s limits.",
              empty: runner.message ?? "No plan limits", onRetry: onRetry)
          }
        }
        if let checked = UsageLimitFormat.checkedAt(limits), checked > 0 {
          Text("Checked \(Date(timeIntervalSince1970: checked / 1000), style: .relative) ago")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
        }
      }
    }
  }

  private func accounts(
    _ accounts: [ArgusProtocol.ClaudeAccountLimits], named: Bool, byName: Bool, now: Date
  ) -> some View {
    ForEach(accounts, id: \.accountId) { account in
      if named {
        LimitsHeader(title: byName ? account.label : "Claude", plan: account.subscriptionType)
      }
      Card {
        LimitsBody(
          state: .init(account.status), windows: account.windows, now: now,
          failure: "Couldn't read this account's limits.", empty: "No plan limits for this account",
          onRetry: onRetry)
      }
    }
  }
}

private struct LimitsHeader: View {
  let title: String
  let plan: String?

  var body: some View {
    HStack(spacing: 6) {
      SectionHeader(title: title)
      if let plan, !plan.isEmpty {
        Badge(label: plan.capitalized)
      }
    }
  }
}

/// A Claude account's or a runner's card: its meters, why it failed, or why
/// there is nothing to show.
private struct LimitsBody: View {
  enum State {
    case ok, failed, unsupported

    init(_ status: ArgusProtocol.ClaudeAccountLimitsStatus) {
      self = status == .ok ? .ok : status == .failed ? .failed : .unsupported
    }

    init(_ status: ArgusProtocol.RunnerUsageLimitsStatus) {
      self = status == .ok ? .ok : status == .failed ? .failed : .unsupported
    }
  }

  @Environment(\.theme) private var theme
  let state: State
  let windows: [ArgusProtocol.UsageLimitWindow]
  let now: Date
  let failure: String
  let empty: String
  let onRetry: () -> Void

  var body: some View {
    switch state {
    case .ok where !windows.isEmpty:
      VStack(alignment: .leading, spacing: theme.space) {
        ForEach(Array(windows.enumerated()), id: \.element.id) { index, window in
          if index > 0 { Divider().overlay(theme.borderSubtle) }
          UsageMeterRow(window: window, now: now)
        }
      }
    case .failed:
      HStack(spacing: theme.space) {
        Self.inline(failure)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.error)
          .frame(maxWidth: .infinity, alignment: .leading)
        Btn(label: "Retry", tone: .secondary, small: true, action: onRetry).fixedSize()
      }
    default:
      Self.inline(empty)
        .font(.scaled(size: 13))
        .foregroundStyle(theme.textMuted)
    }
  }

  /// Runners' messages carry code spans ("Run `codex login` …").
  private static func inline(_ source: String) -> Text {
    var options = AttributedString.MarkdownParsingOptions()
    options.interpretedSyntax = .inlineOnlyPreservingWhitespace
    return (try? AttributedString(markdown: source, options: options)).map(Text.init) ?? Text(source)
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
