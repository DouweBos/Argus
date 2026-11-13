import ArgusKit
import Foundation

/// The cleanup dry run: merged, idle and over-the-limit worktrees across a few
/// projects, three a guard keeps, and last night's sweep.
extension GalleryFixtures {
  private static let day = 86_400_000.0
  private static let gb = 1_073_741_824.0

  public static var worktreeCleanup: [String: String] {
    let now = Date().timeIntervalSince1970 * 1000
    func entry(
      _ project: String, _ branch: String, _ name: String?, gb size: Double, idle: Double,
      landed: Double? = nil, reason: String, blocked: String? = nil
    ) -> [String: Any] {
      var e: [String: Any] = [
        "session_id": "\(project)-\(branch)", "repo_root": "/Users/sam/Projects/\(project)",
        "project_name": project, "branch": branch, "bytes": size * gb,
        "last_activity_at": now - idle * day, "reason": reason,
      ]
      if let name { e["display_name"] = name }
      if let landed { e["landed_at"] = now - landed * day }
      if let blocked { e["blocked_by"] = blocked }
      return e
    }
    let removed = [
      entry("storefront", "fix/cart-badge", "Cart badge count", gb: 2.1, idle: 12, landed: 9, reason: "landed"),
      entry("api", "chore/bump-node", nil, gb: 0.8, idle: 40, reason: "idle"),
    ]
    let preview: [String: Any] = [
      "policy": ["enabled": true, "landed_days": 7, "idle_days": 30, "max_gb": 100],
      "entries": [
        entry("storefront", "feat/checkout-redesign", "Checkout redesign", gb: 6.4, idle: 21, landed: 18, reason: "landed"),
        entry("storefront", "fix/safari-scroll", "Safari scroll jump", gb: 5.9, idle: 15, landed: 11, reason: "landed"),
        entry("mobile", "feat/push-onboarding", "Push onboarding", gb: 14.2, idle: 52, reason: "idle"),
        entry("docs", "auto/dependency-audit", "Dependency audit", gb: 1.3, idle: 34, reason: "idle"),
        entry("mobile", "spike/offline-cache", nil, gb: 11.7, idle: 6, reason: "over_cap"),
        entry("api", "feat/rate-limits", "Rate limits", gb: 3.2, idle: 45, reason: "idle", blocked: "uncommitted"),
        entry("storefront", "exp/server-islands", nil, gb: 4.8, idle: 38, reason: "idle", blocked: "unpushed"),
        entry("mobile", "fix/android-keyboard", "Android keyboard", gb: 9.6, idle: 31, reason: "idle", blocked: "agent_running"),
      ],
      "total_bytes": 128.4 * gb,
      "last_sweep": [
        "at": now - 0.15 * day, "trigger": "scheduled", "removed": removed,
        "freed_bytes": 2.9 * gb, "failed": 0,
      ],
    ]
    return [RemoteMethod.worktreesCleanupPreview.rawValue: GalleryJSON.encode(preview)]
  }
}
