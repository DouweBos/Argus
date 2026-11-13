import ArgusKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A compare run of four slots: Claude Code done with passing tests, Codex still working,
/// Gemini done with failing tests and Cursor still setting up, the last without a screen.
extension GalleryFixtures {
  public static let compareGroupId = "cmp-1"
  static let compareTitle = "Add a dark mode toggle to settings"

  private static let compareSlots: [(id: String, runner: String, model: String?)] = [
    ("s-cmp-claude", "claude-code", "opus"),
    ("s-cmp-codex", "codex", "gpt-5.5"),
    ("s-cmp-gemini", "gemini", nil),
    ("s-cmp-cursor", "cursor", nil),
  ]

  /// The run's sessions, as `sessions.list` returns them alongside the project's others.
  public static var compareSessions: [[String: Any]] {
    compareSlots.enumerated().map { index, slot in
      var group: [String: Any] = ["id": compareGroupId, "slot": index, "runner_id": slot.runner]
      if let model = slot.model { group["model"] = model }
      return session(
        slot.id, branch: "dark-mode-toggle-\(index + 1)", name: compareTitle,
        status: slot.runner == "cursor" ? "initializing" : "ready",
        extra: ["compare_group": group] as [String: Any])
    }
  }

  static var compareScores: [[String: Any]] {
    [
      [
        "session_id": "s-cmp-claude", "slot": 0, "runner_id": "claude-code", "model": "opus", "agent_id": "a-cmp-1",
        "agent_status": "idle", "diff": ["files": 6, "insertions": 214, "deletions": 38],
        "runs": [
          ["title": "Web", "state": "running", "is_test": false],
          ["title": "Unit tests", "state": "passed", "is_test": true],
        ],
        "cost_usd": 1.84, "tokens": 412_300, "has_screen": true,
      ],
      [
        "session_id": "s-cmp-codex", "slot": 1, "runner_id": "codex", "model": "gpt-5.5", "agent_id": "a-cmp-2",
        "agent_status": "running", "diff": ["files": 3, "insertions": 97, "deletions": 12],
        "runs": [["title": "Web", "state": "running", "is_test": false]],
        "cost_usd": 0.62, "tokens": 158_900, "has_screen": true,
      ],
      [
        "session_id": "s-cmp-gemini", "slot": 2, "runner_id": "gemini", "agent_id": "a-cmp-3",
        "agent_status": "idle", "diff": ["files": 9, "insertions": 341, "deletions": 120],
        "runs": [
          ["title": "Web", "state": "running", "is_test": false],
          ["title": "Unit tests", "state": "failed", "is_test": true],
          ["title": "Lint", "state": "passed", "is_test": true],
        ],
        "cost_usd": 0.41, "tokens": 233_400, "has_screen": true,
      ],
      [
        "session_id": "s-cmp-cursor", "slot": 3, "runner_id": "cursor", "runs": [], "cost_usd": 0, "tokens": 0,
        "has_screen": false,
      ],
    ]
  }

  /// The run and its project: sessions, scores, runners and a screenshot per slot but the last.
  public static var compare: [String: String] {
    var fixtures = composer
    let sessions = [session("s-root", branch: "main", kind: "project_root")] + compareSessions
      + Array(argusSessions.dropFirst().prefix(2))
      // A stack beside the run: both indent under a parent row, the same step deep.
      + argusSessions.filter { ["s-stack-1", "s-stack-2"].contains($0["id"] as? String ?? "") }
    fixtures[RemoteMethod.projectsList.rawValue] = GalleryJSON.projects(["Argus"])
    fixtures[RemoteMethod.automationsRunners.rawValue] = GalleryJSON.encode([
      "runners": [
        runner("claude-code", "Claude Code", models: [("opus", "Claude Opus 5.5"), ("sonnet", "Claude Sonnet 5.5")]),
        runner("codex", "Codex", models: [("gpt-5.5", "GPT-5.5"), ("gpt-5.5-mini", "GPT-5.5 mini")]),
        runner("gemini", "Gemini CLI"), runner("cursor", "Cursor"),
      ]
    ])
    fixtures[RemoteMethod.sessionsList.rawValue] = GalleryJSON.encode(["sessions": sessions])
    fixtures[RemoteMethod.agentsList.rawValue] = GalleryJSON.encode(["agents": []])
    fixtures[RemoteMethod.sessionsCompare.rawValue] = GalleryJSON.encode(["slots": compareScores])
    fixtures[RemoteMethod.sessionsCompareScreenshot.rawValue] = GalleryJSON.encode([:])
    let tints: [(CGFloat, CGFloat, CGFloat)] = [(0.36, 0.42, 0.95), (0.18, 0.66, 0.52), (0.92, 0.45, 0.26)]
    for (slot, tint) in zip(compareSlots, tints) {
      fixtures["\(RemoteMethod.sessionsCompareScreenshot.rawValue)?session_id=\(slot.id)"] =
        GalleryJSON.encode(["image": compareScreen(tint: tint)?.base64EncodedString() ?? ""])
    }
    return fixtures
  }

  private static func runner(_ id: String, _ name: String, models: [(String, String)] = []) -> [String: Any] {
    [
      "id": id, "display_name": name, "is_custom": false,
      "models": models.map { ["value": $0.0, "display_name": $0.1] },
    ]
  }

  /// A settings screen drawn in a slot's accent, standing in for its simulator.
  private static func compareScreen(tint: (CGFloat, CGFloat, CGFloat)) -> Data? {
    let (width, height) = (390, 540)
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let accent = CGColor(red: tint.0, green: tint.1, blue: tint.2, alpha: 1)
    context.setFillColor(CGColor(red: 0.96, green: 0.96, blue: 0.97, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.setFillColor(accent)
    context.fill(CGRect(x: 0, y: height - 72, width: width, height: 72))
    for row in 0..<5 {
      let y = CGFloat(height - 130 - row * 74)
      context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
      context.addPath(CGPath(roundedRect: CGRect(x: 16, y: y, width: 358, height: 58), cornerWidth: 10, cornerHeight: 10, transform: nil))
      context.fillPath()
      context.setFillColor(CGColor(red: 0.8, green: 0.8, blue: 0.83, alpha: 1))
      context.fill(CGRect(x: 32, y: y + 24, width: CGFloat(120 + row * 22), height: 10))
      context.setFillColor(row == 1 ? accent : CGColor(red: 0.85, green: 0.85, blue: 0.87, alpha: 1))
      context.addPath(CGPath(roundedRect: CGRect(x: 306, y: y + 15, width: 52, height: 28), cornerWidth: 14, cornerHeight: 14, transform: nil))
      context.fillPath()
    }
    guard let image = context.makeImage() else { return nil }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
      return nil
    }
    CGImageDestinationAddImage(destination, image, nil)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
  }
}
