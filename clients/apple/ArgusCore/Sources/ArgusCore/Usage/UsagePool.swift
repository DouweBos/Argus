import ArgusKit
import Foundation

/// One signed-in account of a provider, as a pool sees it.
public struct UsagePoolAccount: Sendable, Identifiable {
  public let id: String
  public let label: String
  public let plan: String?
  public let windows: [ArgusProtocol.UsageLimitWindow]

  public init(id: String, label: String, plan: String?, windows: [ArgusProtocol.UsageLimitWindow]) {
    self.id = id
    self.label = label
    self.plan = plan
    self.windows = windows
  }

  /// When its session window next resets, epoch ms.
  public var sessionResetsAt: Double? { windows.first { $0.kind == .session }?.resetsAt }

  /// Its account-wide weekly cap is spent, so its session has nothing to give.
  public var weeklySpent: Bool {
    (windows.first { $0.kind == .weekly }?.usedPercent ?? 0) >= 100
  }
}

/// One account's part of a pooled window; `window` nil is a gap.
public struct UsagePoolSegment: Sendable, Identifiable {
  public var id: String { account.id }
  public let account: UsagePoolAccount
  public let window: ArgusProtocol.UsageLimitWindow?
  /// 0–1 of the segment that is used, counting a spent weekly cap as all of a session.
  public let usedFraction: Double
  /// The next reset in this window lands on this segment and restores its used part.
  public let restoresNext: Bool
  /// Used up by the weekly cap rather than by this window.
  public let blockedByWeekly: Bool
}

/// One window id across every account of a provider.
public struct UsagePoolCard: Sendable, Identifiable {
  public let id: String
  public let label: String
  public let segments: [UsagePoolSegment]
  /// 0–100: the left of the accounts reporting this window, averaged.
  public let percentLeft: Int
  /// The soonest reset that gives anything back, and how many pool points it returns.
  public let nextReset: NextReset?

  public struct NextReset: Sendable {
    public let account: UsagePoolAccount
    public let resetsAt: Double
    public let restoresPercent: Int
  }

  public var level: UsageLevel { UsageLimitFormat.level(usedPercent: Double(100 - percentLeft)) }
}

/// A provider with several accounts, pooled: a card per window, accounts in a
/// fixed column order (soonest session reset first).
public struct UsagePool: Sendable, Identifiable {
  public let id: String
  public let label: String
  public let accounts: [UsagePoolAccount]
  public let cards: [UsagePoolCard]
}

public enum UsagePooling {
  /// Nil with fewer than two accounts: a single account keeps per-window meters.
  public static func pool(id: String, label: String, accounts input: [UsagePoolAccount], now: Date) -> UsagePool? {
    let reporting = input.filter { !$0.windows.isEmpty }
    guard reporting.count > 1 else { return nil }
    let accounts = reporting.enumerated()
      .sorted { lhs, rhs in
        switch (lhs.element.sessionResetsAt, rhs.element.sessionResetsAt) {
        case let (l?, r?) where l != r: l < r
        case (_?, nil): true
        case (nil, _?): false
        default: lhs.offset < rhs.offset
        }
      }
      .map(\.element)
    var ids: [String] = []
    var labels: [String: String] = [:]
    for window in accounts.flatMap(\.windows) where labels[window.id] == nil {
      ids.append(window.id)
      labels[window.id] = window.label
    }
    let nowMs = now.timeIntervalSince1970 * 1000
    let cards = ids.map { card(id: $0, label: labels[$0] ?? $0, accounts: accounts, nowMs: nowMs) }
    return UsagePool(id: id, label: label, accounts: accounts, cards: cards)
  }

  /// Claude's accounts with limits, pooled; nil with fewer than two.
  public static func claude(_ limits: ArgusProtocol.ClaudeUsageLimits?, now: Date) -> UsagePool? {
    let accounts = (limits?.accounts ?? []).filter { $0.status == .ok }.map {
      UsagePoolAccount(id: $0.accountId, label: $0.label, plan: $0.subscriptionType, windows: $0.windows)
    }
    return pool(id: "claude", label: "Claude", accounts: accounts, now: now)
  }

  private static func card(id: String, label: String, accounts: [UsagePoolAccount], nowMs: Double) -> UsagePoolCard {
    let found = accounts.map { account in (account, account.windows.first { $0.id == id }) }
    let blocked = { (account: UsagePoolAccount, window: ArgusProtocol.UsageLimitWindow) in
      window.kind == .session && account.weeklySpent
    }
    let used = { (account: UsagePoolAccount, window: ArgusProtocol.UsageLimitWindow) -> Double in
      blocked(account, window) ? 1 : UsageLimitFormat.fraction(usedPercent: window.usedPercent)
    }
    let present = found.compactMap { pair in pair.1.map { (pair.0, $0) } }
    let left = present.map { 1 - used($0.0, $0.1) }.reduce(0, +)
    let percentLeft = present.isEmpty ? 0 : Int((left / Double(present.count) * 100).rounded(.down))
    let next = present
      .filter { account, window in
        !blocked(account, window) && window.usedPercent > 0 && (window.resetsAt ?? 0) > nowMs
      }
      .min { ($0.1.resetsAt ?? 0) < ($1.1.resetsAt ?? 0) }
    let nextReset = next.map { account, window in
      UsagePoolCard.NextReset(
        account: account, resetsAt: window.resetsAt ?? 0,
        restoresPercent: Int((used(account, window) / Double(present.count) * 100).rounded()))
    }
    let segments = found.map { account, window in
      UsagePoolSegment(
        account: account, window: window, usedFraction: window.map { used(account, $0) } ?? 0,
        restoresNext: next?.0.id == account.id && window != nil,
        blockedByWeekly: window.map { blocked(account, $0) } ?? false)
    }
    return UsagePoolCard(id: id, label: label, segments: segments, percentLeft: percentLeft, nextReset: nextReset)
  }
}
