import ArgusKit
import Foundation

/// Plan limits for two Claude accounts and three other runners (one fine, one
/// failing, one without limits), and a week of usage across three runners.
extension GalleryFixtures {
  private static let hour = 3_600_000.0
  private static let day = 86_400_000.0

  public static var usage: [String: String] {
    [
      RemoteMethod.usageLimits.rawValue: GalleryJSON.encode(usageLimitsByRunner),
      RemoteMethod.usageSummary.rawValue: GalleryJSON.encode(usageSummary),
    ]
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

  private static var usageLimitsByRunner: [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    return [
      "accounts": [
        [
          "account_id": "work", "label": "Work", "status": "ok", "subscription_type": "max",
          "checked_at": now - 60_000,
          "windows": [
            limitWindow("session", "session", "Current session", used: 86, resetsIn: 2.2 * hour, minutes: 300),
            limitWindow(
              "weekly", "weekly", "This week, all models", used: 41, resetsIn: 3.5 * day, minutes: 10_080, pace: "under"),
            limitWindow("weekly-opus", "weekly", "This week, Opus", used: 100, resetsIn: 3.5 * day, minutes: 10_080),
          ],
        ],
        [
          "account_id": "personal", "label": "Personal", "status": "ok", "subscription_type": "pro",
          "checked_at": now - 60_000,
          "windows": [
            limitWindow("session", "session", "Current session", used: 12, resetsIn: 4.1 * hour, minutes: 300),
            limitWindow("weekly", "weekly", "This week, all models", used: 27, resetsIn: 5 * day, minutes: 10_080),
          ],
        ],
      ],
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

  /// Cost per day for each runner, scaled so tokens follow the same shape.
  private static let runnerDays: [(id: String, label: String, sessions: Int, tokensPerDollar: Double, costs: [Double])] = [
    ("claude", "Claude Code", 38, 1_640_000, [6.2, 11.4, 8.9, 3.1, 9.7, 12.8, 6.3]),
    ("codex", "Codex", 14, 3_390_000, [0.8, 2.1, 1.4, 0.3, 3.2, 2.6, 1.7]),
    ("gemini", "Gemini", 6, 2_880_000, [0, 0.4, 0.9, 0, 0.2, 1.1, 0.7]),
  ]

  private static var usageSummary: [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    let today = (now / day).rounded(.down) * day
    let starts = (0..<7).map { today - Double(6 - $0) * day }
    let runners: [[String: Any]] = runnerDays.map { runner in
      let cost = runner.costs.reduce(0, +)
      return [
        "runner": runner.id, "label": runner.label, "sessions": runner.sessions, "priced": true,
        "tokens": cost * runner.tokensPerDollar, "cost_usd": cost,
        "series": zip(starts, runner.costs).map { start, cost in
          ["start": start, "tokens": cost * runner.tokensPerDollar, "cost_usd": cost]
        },
      ]
    }
    let series = starts.indices.map { index -> [String: Any] in
      let cost = runnerDays.map { $0.costs[index] }.reduce(0, +)
      let tokens = runnerDays.map { $0.costs[index] * $0.tokensPerDollar }.reduce(0, +)
      return ["start": starts[index], "tokens": tokens, "cost_usd": cost]
    }
    let totalTokens = runners.compactMap { $0["tokens"] as? Double }.reduce(0, +)
    let totalCost = runners.compactMap { $0["cost_usd"] as? Double }.reduce(0, +)
    let geminiCost = runnerDays[2].costs.reduce(0, +)
    let priced = totalCost - geminiCost
    return [
      "range": "7d", "since": starts[0], "until": now, "bucket": "day", "sessions": 58,
      "tokens": [
        "processed": totalTokens, "input": totalTokens * 0.028, "cache_read": totalTokens * 0.874,
        "cache_write": totalTokens * 0.064, "output": totalTokens * 0.034,
      ],
      "cost": [
        "total": totalCost, "input": priced * 0.14, "cache_read": priced * 0.34, "cache_write": priced * 0.25,
        "output": priced * 0.27, "other": geminiCost,
      ],
      "cache_savings_usd": 212.4,
      "series": series,
      "models": [
        ["model": "claude-opus-5-5", "runner": "claude", "tokens": 71_200_000, "cost_usd": 47.9, "priced": true],
        ["model": "gpt-5.5-codex", "runner": "codex", "tokens": 41_000_000, "cost_usd": 12.1, "priced": true],
        ["model": "claude-sonnet-5-5", "runner": "claude", "tokens": 25_400_000, "cost_usd": 10.5, "priced": true],
        ["model": "gemini-3-pro", "runner": "gemini", "tokens": 9_500_000, "cost_usd": geminiCost, "priced": true],
      ],
      "runners": runners,
      "prices_fetched_at": now - day,
    ]
  }
}
