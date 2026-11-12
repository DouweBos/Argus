import Foundation

/// The `.command` transcript: the runner's own slash commands, one bare and one
/// with text after it.
extension GalleryFixtures {
  static var commandChat: [[String: Any]] {
    [
      [
        "id": "c1", "role": "user", "tool_calls": [], "timestamp": minutes(0),
        "text_blocks": ["/review"], "command": ["name": "review"],
      ],
      [
        "id": "c2", "role": "assistant", "timestamp": minutes(3), "tool_calls": [],
        "text_blocks": [
          "Reviewed the branch: two findings. The transcript row skips the plain-text fast path for every user message, and the new fixture has no iPad story."
        ],
      ],
      [
        "id": "c3", "role": "user", "tool_calls": [], "timestamp": minutes(24),
        "text_blocks": ["/compact keep the review findings and the gallery paths"],
        "command": ["name": "compact", "args": "keep the review findings and the gallery paths"],
      ],
      [
        "id": "c4", "role": "assistant", "timestamp": minutes(25), "tool_calls": [],
        "text_blocks": ["Compacted. Both findings are still open; the gallery renders are under `/tmp/argus-gallery`."],
      ],
    ]
  }

  /// Like the other transcripts, the chat ends a few minutes ago.
  private static func minutes(_ m: Double) -> Double {
    ((Date().timeIntervalSince1970 / 60).rounded(.down) - 32 + m) * 60_000
  }
}
