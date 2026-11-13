import ArgusKit
import Foundation

/// Plan limits for one Claude account (or three, pooled) and five other runners
/// (fine, failing, without limits), a week of usage across four runners, and
/// model prices with a hand-set price and a mapping, and a model filter with
/// both lists in use.
extension GalleryFixtures {
  private static let hour = 3_600_000.0
  private static let day = 86_400_000.0

  public static var usage: [String: String] {
    [
      RemoteMethod.usageLimits.rawValue: GalleryJSON.encode(usageLimits(accounts: [workAccount])),
      RemoteMethod.usageSummary.rawValue: GalleryJSON.encode(usageSummary),
      RemoteMethod.usagePrices.rawValue: GalleryJSON.encode(usagePrices),
      RemoteMethod.usageModelFilter.rawValue: GalleryJSON.encode(["filter": usageModelFilter]),
      RemoteMethod.automationsRunners.rawValue: composer[RemoteMethod.automationsRunners.rawValue] ?? "{}",
    ]
  }

  /// Counts two Claude models on any runner and one on Codex; leaves two out.
  private static var usageModelFilter: [String: Any] {
    [
      "include": [
        ["runner": NSNull(), "model": "claude-opus-5-5"],
        ["runner": NSNull(), "model": "claude-sonnet-5-5"],
        ["runner": "codex", "model": "gpt-5.5-codex"],
      ],
      "exclude": [
        ["runner": NSNull(), "model": "claude-haiku-4-5"],
        ["runner": "gemini", "model": "gemini-2.5-flash"],
      ],
    ]
  }

  /// Three Claude accounts pooled: one's weekly cap is spent.
  public static var usagePooled: [String: String] {
    usage.merging([
      RemoteMethod.usageLimits.rawValue: GalleryJSON.encode(
        usageLimits(accounts: [workAccount, personalAccount, spentAccount]))
    ]) { $1 }
  }

  private static func limitWindow(
    _ id: String, _ kind: String, _ label: String, used: Double, resetsIn: Double, minutes: Double,
    pace: String? = nil
  ) -> [String: Any] {
    var window: [String: Any] = [
      "id": id, "kind": kind, "label": label, "used_percent": used,
      "resets_at": Date().timeIntervalSince1970 * 1000 + resetsIn, "window_minutes": minutes,
    ]
    if let pace { window["pace"] = pace }
    return window
  }

  private static func account(
    _ id: String, _ label: String, plan: String, windows: [[String: Any]]
  ) -> [String: Any] {
    [
      "account_id": id, "label": label, "status": "ok", "subscription_type": plan,
      "checked_at": Date().timeIntervalSince1970 * 1000 - 60_000, "windows": windows,
    ]
  }

  private static var workAccount: [String: Any] {
    account("work", "Work", plan: "max", windows: [
      limitWindow("five_hour", "session", "Session", used: 86, resetsIn: 2.2 * hour, minutes: 300),
      limitWindow("seven_day", "weekly", "Weekly", used: 41, resetsIn: 3.5 * day, minutes: 10_080, pace: "under"),
      limitWindow("seven_day_opus", "weekly", "Weekly · Opus", used: 100, resetsIn: 3.5 * day, minutes: 10_080),
    ])
  }

  private static var personalAccount: [String: Any] {
    account("personal", "Personal", plan: "pro", windows: [
      limitWindow("five_hour", "session", "Session", used: 64, resetsIn: 48 * 60_000, minutes: 300),
      limitWindow("seven_day", "weekly", "Weekly", used: 27, resetsIn: 5 * day, minutes: 10_080),
    ])
  }

  private static var spentAccount: [String: Any] {
    account("team", "Team seat", plan: "team", windows: [
      limitWindow("five_hour", "session", "Session", used: 5, resetsIn: 4.1 * hour, minutes: 300),
      limitWindow("seven_day", "weekly", "Weekly", used: 100, resetsIn: 1.5 * day, minutes: 10_080),
    ])
  }

  private static func usageLimits(accounts: [[String: Any]]) -> [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    return [
      "accounts": accounts,
      "runners": [
        [
          "runner": "codex", "label": "Codex", "status": "ok", "plan": "pro", "checked_at": now - 30_000,
          "windows": [
            limitWindow("primary", "session", "Current session", used: 34, resetsIn: 3.4 * hour, minutes: 300),
            limitWindow(
              "secondary", "weekly", "This week", used: 62, resetsIn: 2 * day, minutes: 10_080, pace: "ahead"),
          ],
        ],
        [
          "runner": "opencode", "label": "OpenCode", "status": "ok", "plan": "zen", "checked_at": now - 30_000,
          "windows": [
            limitWindow("monthly", "monthly", "Monthly spend", used: 23, resetsIn: 12 * day, minutes: 43_200)
          ],
        ],
        [
          "runner": "antigravity", "label": "Antigravity", "status": "ok", "plan": "pro", "checked_at": now - 30_000,
          "windows": [
            limitWindow("gemini", "session", "Gemini models", used: 48, resetsIn: 3 * hour, minutes: 300),
            limitWindow("claude", "session", "Claude models", used: 91, resetsIn: 1.2 * hour, minutes: 300),
          ],
        ],
        [
          "runner": "cursor", "label": "Cursor", "status": "failed", "checked_at": now - 90_000,
          "message": "Cursor's usage page didn't answer. Check that you're signed in to Cursor.", "windows": [],
        ],
        [
          "runner": "grok", "label": "Grok", "status": "unsupported", "checked_at": now - 90_000,
          "message": "Grok doesn't report plan limits.", "windows": [],
        ],
      ],
    ]
  }

  private static var usagePrices: [String: Any] {
    [
      "overrides": [
        [
          "model": "qwen3-coder-local", "input_per_mtok": 0.2, "output_per_mtok": 0.8, "cache_read_per_mtok": NSNull(),
          "cache_write_per_mtok": NSNull(), "map_to": NSNull(),
        ],
        [
          "model": "claude-opus-5-5-fast", "input_per_mtok": NSNull(), "output_per_mtok": NSNull(),
          "cache_read_per_mtok": NSNull(), "cache_write_per_mtok": NSNull(), "map_to": "claude-opus-5-5",
        ],
      ],
      "list": [
        ["model": "claude-opus-5-5", "input_per_mtok": 5, "output_per_mtok": 25, "cache_read_per_mtok": 0.5, "cache_write_per_mtok": 6.25],
        ["model": "claude-sonnet-5-5", "input_per_mtok": 3, "output_per_mtok": 15, "cache_read_per_mtok": 0.3, "cache_write_per_mtok": 3.75],
        ["model": "gpt-5.5-codex", "input_per_mtok": 1.25, "output_per_mtok": 10, "cache_read_per_mtok": 0.125, "cache_write_per_mtok": 1.25],
      ],
    ]
  }

  /// Cost per day for each runner, scaled so tokens follow the same shape.
  private static let runnerDays: [(id: String, label: String, sessions: Int, tokensPerDollar: Double, costs: [Double])] = [
    ("claude-code", "Claude Code", 38, 1_640_000, [6.2, 11.4, 8.9, 3.1, 9.7, 12.8, 6.3]),
    ("codex", "Codex", 14, 3_390_000, [0.8, 2.1, 1.4, 0.3, 3.2, 2.6, 1.7]),
    ("gemini", "Gemini", 6, 2_880_000, [0, 0.4, 0.9, 0, 0.2, 1.1, 0.7]),
  ]

  /// A model's share of its runner's days, with its own tokens by kind and price source.
  private static func model(
    _ id: String, runner: Int, share: Double, source: String, kinds: (Double, Double, Double, Double),
    mapped: [String]? = nil, starts: [Double]
  ) -> [String: Any] {
    let days = runnerDays[runner]
    let costs = days.costs.map { $0 * share }
    let tokens = costs.reduce(0, +) * days.tokensPerDollar
    var row: [String: Any] = [
      "model": id, "runner": days.id, "tokens": tokens, "cost_usd": costs.reduce(0, +), "priced": true,
      "price_source": source,
      "token_kinds": [
        "processed": tokens, "input": tokens * kinds.0, "cache_read": tokens * kinds.1,
        "cache_write": tokens * kinds.2, "output": tokens * kinds.3,
      ],
      "series": zip(starts, costs).map { start, cost in
        ["start": start, "tokens": cost * days.tokensPerDollar, "cost_usd": cost]
      },
    ]
    if let mapped { row["mapped_from"] = mapped }
    return row
  }

  private static var usageSummary: [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    let today = (now / day).rounded(.down) * day
    let starts = (0..<7).map { today - Double(6 - $0) * day }
    let local = [0, 0, 1.2e6, 2.1e6, 0.4e6, 1.9e6, 1.2e6]
    let opencode: [String: Any] = [
      "runner": "opencode", "label": "OpenCode", "sessions": 4, "priced": false, "tokens": local.reduce(0, +),
      "cost_usd": 0, "series": zip(starts, local).map { ["start": $0, "tokens": $1, "cost_usd": 0] },
    ]
    let priced: [[String: Any]] = runnerDays.map { runner in
      let cost = runner.costs.reduce(0, +)
      return [
        "runner": runner.id, "label": runner.label, "sessions": runner.sessions, "priced": true,
        "tokens": cost * runner.tokensPerDollar, "cost_usd": cost,
        "series": zip(starts, runner.costs).map { start, cost in
          ["start": start, "tokens": cost * runner.tokensPerDollar, "cost_usd": cost]
        },
      ]
    }
    let runners = priced + [opencode]
    let series = starts.indices.map { index -> [String: Any] in
      let cost = runnerDays.map { $0.costs[index] }.reduce(0, +)
      let tokens = runnerDays.map { $0.costs[index] * $0.tokensPerDollar }.reduce(0, +) + local[index]
      return ["start": starts[index], "tokens": tokens, "cost_usd": cost]
    }
    let totalTokens = runners.compactMap { $0["tokens"] as? Double }.reduce(0, +)
    let totalCost = runners.compactMap { $0["cost_usd"] as? Double }.reduce(0, +)
    let geminiCost = runnerDays[2].costs.reduce(0, +)
    let listed = totalCost - geminiCost
    return [
      "range": "7d", "since": starts[0], "until": now, "bucket": "day", "sessions": 58,
      "tokens": [
        "processed": totalTokens, "input": totalTokens * 0.028, "cache_read": totalTokens * 0.874,
        "cache_write": totalTokens * 0.064, "output": totalTokens * 0.034,
      ],
      "cost": [
        "total": totalCost, "input": listed * 0.14, "cache_read": listed * 0.34, "cache_write": listed * 0.25,
        "output": listed * 0.27, "other": geminiCost, "premium": 8.2,
      ],
      "cache_savings_usd": 212.4,
      "series": series,
      "models": [
        model(
          "claude-opus-5-5", runner: 0, share: 0.72, source: "list", kinds: (0.02, 0.88, 0.07, 0.03),
          mapped: ["claude-opus-5-5-fast"], starts: starts),
        model("gpt-5.5-codex", runner: 1, share: 1, source: "list", kinds: (0.05, 0.86, 0, 0.09), starts: starts),
        model("claude-sonnet-5-5", runner: 0, share: 0.28, source: "custom", kinds: (0.04, 0.83, 0.09, 0.04), starts: starts),
        model("gemini-3-pro", runner: 2, share: 1, source: "reported", kinds: (0.3, 0.6, 0, 0.1), starts: starts),
        [
          "model": "qwen3-coder-30b", "runner": "opencode", "tokens": local.reduce(0, +), "cost_usd": 0, "priced": false,
          "price_source": "none",
          "token_kinds": [
            "processed": 6_800_000, "input": 2_100_000, "cache_read": 4_300_000, "cache_write": 0, "output": 400_000,
          ],
          "series": starts.enumerated().map { index, start in
            ["start": start, "tokens": local[index], "cost_usd": 0]
          },
        ],
      ],
      "speeds": [
        ["speed": "standard", "tokens": totalTokens * 0.83, "cost_usd": totalCost - 14.6, "premium_usd": 0],
        ["speed": "fast", "tokens": totalTokens * 0.17, "cost_usd": 14.6, "premium_usd": 8.2],
      ],
      "runners": runners,
      "prices_fetched_at": now - day,
    ]
  }
}
