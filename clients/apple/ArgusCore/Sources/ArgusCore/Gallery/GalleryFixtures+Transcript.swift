import ArgusKit
import Foundation

/// One agent's chat in each state the agent screen shows, shared by the Mac and
/// iOS transcript stories. The agent is always `transcriptAgent`.
extension GalleryFixtures {
  public static let transcriptAgent = "gallery-agent"
  public static let transcriptSession = "gallery-session"

  public enum TranscriptState: Sendable {
    /// A finished turn with follow-ups suggested.
    case idle
    /// Mid-turn: a running call, tasks and todos, a queued and an unsent message.
    case working
    /// Waiting on a Bash permission.
    case permission
    /// Waiting on an AskUserQuestion answer.
    case question
    /// Waiting on plan approval.
    case plan
    /// A sub-agent and a background shell still running.
    case subagents
    /// The process is gone.
    case stopped
    /// Stopped on a spent usage limit, a continue scheduled.
    case limit
    /// Nothing said yet.
    case empty
    /// Continued on Codex from a Claude Code chat that hit its limit.
    case handoff
  }

  /// Every reply the agent screen asks for, in `state`.
  public static func transcript(_ state: TranscriptState) -> [String: String] {
    var fixtures = composer
    fixtures[RemoteMethod.agentsStatus.rawValue] = GalleryJSON.encode(["agent": agentStatus(state)])
    fixtures[RemoteMethod.agentsTranscript.rawValue] = GalleryJSON.encode(transcriptPage(state))
    fixtures[RemoteMethod.agentsQueueList.rawValue] = GalleryJSON.encode([
      "messages": state == .working
        ? [["id": "q1", "text": "Then run the gallery for both themes and post the paths.", "queued_at": t(30)]]
        : []
    ])
    fixtures[RemoteMethod.agentsMcpStatus.rawValue] = GalleryJSON.encode(mcpStatus)
    fixtures[RemoteMethod.sessionsViewing.rawValue] = "{}"
    fixtures[RemoteMethod.sessionsList.rawValue] = GalleryJSON.encode(["sessions": [Any]()])
    fixtures[RemoteMethod.sessionsFiles.rawValue] = GalleryJSON.encode(["files": [
      "clients/apple/ArgusUI/Sources/ArgusUI/Views/AgentTranscriptView.swift",
      "clients/apple/ArgusUI/Sources/ArgusUI/DesignSystem/ReadingColumn.swift",
    ]])
    fixtures[RemoteMethod.claudeAccountsList.rawValue] = GalleryJSON.encode([
      "active_id": "personal",
      "accounts": [
        [
          "id": "personal", "label": "Personal", "email": "dev@example.com", "subscription_type": "Max",
          "needs_reauth": false, "rate_limited": state == .limit, "account_type": "claudeai",
        ],
        [
          "id": "work", "label": "Work", "email": "dev@acme.com", "org_name": "Acme", "subscription_type": "Team",
          "needs_reauth": false, "rate_limited": false, "account_type": "claudeai",
        ],
      ],
    ])
    fixtures[RemoteMethod.agentsLimitHandoff.rawValue] = GalleryJSON.encode([
      "accounts": state == .limit ? [["account_id": "work", "label": "Work", "detail": "Acme · Team"]] : []
    ])
    // The Mac's file links ask which worktree the session is in and which editors there are.
    fixtures["get_session"] = "null"
    fixtures["list_editors"] = GalleryJSON.encode([["id": "vscode", "name": "Visual Studio Code", "available": true]])
    return fixtures
  }

  /// The agent's MCP servers, one in every state.
  public static var mcpStatus: [String: Any] {
    [
      "servers": [
        ["name": "argus", "status": "connected", "source": "project", "tool_count": 48],
        ["name": "conductor", "status": "connected", "source": "user", "tool_count": 31],
        ["name": "claude.ai Linear", "status": "connected", "source": "claude.ai", "tool_count": 22],
        ["name": "claude.ai Slack", "status": "needs-auth", "source": "claude.ai"],
        ["name": "figma-dev-mode", "status": "pending", "source": "user"],
        [
          "name": "posthog", "status": "failed", "source": "user",
          "error": "spawn npx ENOENT: the command could not be found on PATH",
        ],
        ["name": "playwright", "status": "disabled", "source": "project"],
      ]
    ]
  }

  // MARK: Status

  private static func agentStatus(_ state: TranscriptState) -> [String: Any] {
    let status: String =
      switch state {
      case .idle, .empty, .limit, .handoff: "idle"
      case .working, .subagents: "running"
      case .permission, .question, .plan: "requires_action"
      case .stopped: "stopped"
      }
    var agent: [String: Any] = [
      "agent_id": transcriptAgent, "session_id": transcriptSession, "session_label": "Cap the iPad transcript",
      "project_name": "Argus", "title": "Cap the iPad transcript", "status": status,
      "model": "claude-opus-5-5", "context_window": 200_000, "permission_mode": "default",
      "created_at": t(0), "last_activity_at": t(31), "runner_id": "claude-code",
      "runner_session_id": "6c1f0a52-3c1e-4c0e-9d57-6b0e1d1f2a11",
    ]
    switch state {
    case .permission: agent["awaiting"] = "permission"
    case .question: agent["awaiting"] = "question"
    case .plan:
      agent["awaiting"] = "plan"
      agent["permission_mode"] = "plan"
    case .limit:
      agent["limit_stalled"] = true
      agent["limit_resume_at"] = Date().timeIntervalSince1970 * 1000 + 2 * 3_600_000
    case .handoff:
      agent["runner_id"] = "codex"
      agent["model"] = "gpt-5.5-codex"
    default: break
    }
    return agent
  }

  // MARK: Transcript

  private static func transcriptPage(_ state: TranscriptState) -> [String: Any] {
    var page: [String: Any] = ["messages": messages(state), "total": messages(state).count]
    switch state {
    case .idle:
      page["follow_ups"] = [
        "Run the iOS gallery on the iPad too", "Commit this", "Check the stopped footer on a 320pt phone",
      ]
    case .working:
      page["pending_tool_name"] = "Bash"
      page["tasks"] = [
        ["id": "1", "subject": "Cap the transcript", "activeForm": "Capping the transcript", "status": "completed"],
        [
          "id": "2", "subject": "Match the Mac's message rows", "activeForm": "Matching the Mac's message rows",
          "status": "in_progress",
        ],
        ["id": "3", "subject": "Render both galleries", "status": "pending"],
      ]
      page["todos"] = [
        ["content": "Read the Mac transcript rows", "status": "completed"],
        ["content": "Build for the iOS simulator", "activeForm": "Building for the iOS simulator", "status": "in_progress"],
        ["content": "Write the changeset", "status": "pending"],
      ]
    default: break
    }
    return page
  }

  private static func messages(_ state: TranscriptState) -> [[String: Any]] {
    switch state {
    case .empty: return []
    case .idle, .stopped, .limit: return conversation + [finalAnswer]
    case .working: return conversation + working
    case .permission: return conversation + [pending(bashPermission)]
    case .question: return conversation + [pending(question)]
    case .plan: return conversation + [pending(plan)]
    case .subagents: return conversation + subagents
    case .handoff: return handedOff
    }
  }

  private static var handedOff: [[String: Any]] {
    [
      [
        "id": "h0", "role": "system", "text_blocks": ["Continued on Codex from Claude Code"], "tool_calls": [],
        "timestamp": t(14),
        "handoff": ["from_agent_id": "gallery-claude", "from_runner": "Claude Code", "to_runner": "Codex"],
      ],
      user("h1", 14, "Continue where Claude Code left off."),
      assistant(
        "h2", 15, text: ["Picking up from the capped transcript: the Mac rows are done, the iOS build is next."],
        calls: [
          call(
            "h3", "Bash", ["command": "git status --short"],
            output: " M clients/apple/ArgusUI/Sources/ArgusUI/Views/AgentTranscriptView.swift"),
          call(
            "h4", "Bash",
            [
              "command":
                "xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusRemote -destination 'generic/platform=iOS Simulator' build"
            ], output: "** BUILD SUCCEEDED **"),
        ]),
      assistant(
        "h5", 17,
        text: [
          "The iOS build passes with the transcript in the reading column. Left from the todo list: the changeset."
        ]),
    ]
  }

  private static var conversation: [[String: Any]] {
    [
      user(
        "u1", 0,
        "The transcript on the iPad stretches edge to edge while the composer is capped. Put both in the reading column, like the Mac."
      ),
      assistant("m1", 2, text: ["I'll start with how the Mac lays out its column, then compare the phone's rows."]),
      assistant(
        "m2", 4,
        calls: [
          call(
            "c1", "Grep", ["pattern": "readingColumn", "path": "clients/apple"],
            output: """
              clients/apple/ArgusDesktop/Shell/Transcript/TranscriptTableRows.swift:36
              clients/apple/ArgusUI/Sources/ArgusUI/Views/ChatInput/MacChatInputView.swift:65
              clients/apple/ArgusUI/Sources/ArgusUI/Views/ChatInput/PhoneChatInputView.swift:63
              """),
          call(
            "c2", "Read",
            ["file_path": "/Users/dev/Projects/Argus/clients/apple/ArgusUI/Sources/ArgusUI/DesignSystem/ReadingColumn.swift"],
            output: "1\timport SwiftUI\n2\t\n3\tpublic enum ReadingColumn {\n4\t  public static let maxWidth: CGFloat = 700\n5\t  public static let gutter: CGFloat = 20\n6\t}"),
          call(
            "c3", "Read",
            ["file_path": "/Users/dev/Projects/Argus/clients/apple/ArgusUI/Sources/ArgusUI/Views/AgentTranscriptView.swift"],
            output: "1\timport ArgusCore\n2\timport SwiftUI\n3\t\n4\tpublic struct AgentTranscriptView: View {"),
        ]),
      assistant(
        "m3", 6, text: ["The rows sit in a plain `LazyVStack`. Capping it there keeps the scroll view full width."],
        calls: [
          call(
            "c4", "Edit",
            [
              "file_path": "/Users/dev/Projects/Argus/clients/apple/ArgusUI/Sources/ArgusUI/Views/AgentTranscriptView.swift",
              "old_string": "        .padding(theme.space)\n      }",
              "new_string": "        .padding(theme.space)\n        .frame(maxWidth: ReadingColumn.maxWidth)\n        .frame(maxWidth: .infinity)\n      }",
            ], output: "The file has been updated.")
        ]),
      assistant(
        "m4", 9,
        calls: [
          call(
            "c5", "Bash",
            [
              "command": "xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusRemote -destination 'generic/platform=iOS Simulator' build | tail -3",
              "description": "Build the iOS app",
            ],
            output: "AgentTranscriptView.swift:88:9: error: cannot find 'ReadingColumn' in scope\n** BUILD FAILED **",
            error: true),
          call(
            "c6", "Bash",
            [
              "command": "xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusRemote -destination 'generic/platform=iOS Simulator' build | tail -1",
              "description": "Build the iOS app again",
            ],
            output: "** BUILD SUCCEEDED **"),
        ]),
    ]
  }

  private static var finalAnswer: [String: Any] {
    assistant(
      "m5", 12,
      text: [
        """
        The transcript now reads in the same column as the composer on the iPad.

        ## What changed
        - **`AgentTranscriptView`** caps its rows at `ReadingColumn.maxWidth` (700pt) and centres them, so the scroll view still scrolls from the screen's edge.
        - The stopped footer follows the same column.
        - Phones are unchanged: 440pt is narrower than the column.

        ```swift
        LazyVStack(alignment: .leading, spacing: 10) { … }
          .padding(theme.space)
          .frame(maxWidth: ReadingColumn.maxWidth)
          .frame(maxWidth: .infinity)
        ```

        | Device | Width | Column |
        |---|---|---|
        | iPhone SE | 320pt | 288pt |
        | iPhone 17 Pro Max | 440pt | 408pt |
        | iPad Pro 13" | 1032pt | 700pt |

        Both builds pass. See `clients/apple/ArgusUI/Sources/ArgusUI/Views/AgentTranscriptView.swift:88`.
        """
      ])
  }

  private static var working: [[String: Any]] {
    [
      finalAnswer,
      user("u2", 20, "Good. Now make the assistant replies read like the Mac's: no grey box around them."),
      assistant(
        "m6", 22, text: ["Looking at the Mac's message row first."],
        calls: [
          call(
            "c7", "Read",
            ["file_path": "/Users/dev/Projects/Argus/clients/apple/ArgusDesktop/Shell/Transcript/TranscriptRows.swift"],
            output: "1\timport ArgusUI\n2\timport SwiftUI"),
          call(
            "c8", "Bash", ["command": "swift test --package-path clients/apple/ArgusUI", "description": "Run ArgusUI tests"],
            status: "running"),
        ]),
    ]
  }

  private static var subagents: [[String: Any]] {
    [
      finalAnswer,
      user("u2", 20, "Find every other screen that still stretches on the iPad, and keep the gallery rendering meanwhile."),
      assistant(
        "m6", 22, text: ["I'll send an explorer through the screens and start the gallery in the background."],
        calls: [
          call(
            "c9", "Agent",
            [
              "subagent_type": "Explore", "description": "Find stretched iPad screens",
              "prompt": "List every ArgusRemote screen whose content isn't capped to ReadingColumn.maxWidth.",
            ],
            status: "running",
            children: [
              ["kind": "text", "text": "Searching ArgusRemote/Screens for scroll views."],
              [
                "kind": "tool_use",
                "tool_call": call("c9a", "Glob", ["pattern": "clients/apple/ArgusRemote/Screens/*.swift"], output: "AgentView.swift\nStoppedAgentView.swift\nSessionDetailsView.swift"),
              ],
              [
                "kind": "tool_use",
                "tool_call": call("c9b", "Grep", ["pattern": "ScrollView", "path": "clients/apple/ArgusRemote/Screens"], status: "running"),
              ],
            ]),
          call(
            "c10", "Bash",
            ["command": "pnpm gallery transcript --ios --device \"iPad Pro 13-inch (M5)\"", "run_in_background": true, "description": "Render the iPad gallery"],
            output: "Command running in background with ID: b7f2c1",
            background: ["status": "running", "started_at": t(23)]),
          call(
            "c11", "Bash",
            ["command": "pnpm gallery transcript", "run_in_background": true, "description": "Render the Mac gallery"],
            output: "Command running in background with ID: b7f2c0",
            background: ["status": "completed", "started_at": t(23), "duration_ms": 41_000]),
        ]),
    ]
  }

  // MARK: Decisions

  private static var bashPermission: [String: Any] {
    call(
      "p1", "Bash",
      [
        "command": "rm -rf ~/Library/Developer/Xcode/DerivedData/ArgusRemote-*",
        "description": "Clear stale derived data",
      ], status: "pending")
  }

  private static var question: [String: Any] {
    call(
      "p2", "AskUserQuestion",
      [
        "questions": [
          [
            "question": "How wide should the iPad transcript be?", "header": "Width", "multiSelect": false,
            "options": [
              ["label": "Reading column", "description": "700pt, centred, as on the Mac"],
              ["label": "Full width", "description": "Edge to edge, as it is now"],
              ["label": "Follow the split view", "description": "Capped only when the sidebar is hidden"],
            ],
          ]
        ]
      ], status: "pending")
  }

  private static var plan: [String: Any] {
    call(
      "p3", "ExitPlanMode",
      [
        "plan": """
          ## Cap the iPad transcript

          1. Cap `AgentTranscriptView`'s rows at `ReadingColumn.maxWidth`, centred.
          2. Put the stopped footer's content in the same column.
          3. Render `transcript/*` on the iPhone and the iPad, both themes.
          4. Add a patch changeset.
          """
      ], status: "pending")
  }

  private static func pending(_ call: [String: Any]) -> [String: Any] {
    assistant("m6", 14, text: ["Before I rebuild, the derived data needs clearing."], calls: [call])
  }

  // MARK: Builders

  /// Minutes after the chat started, in epoch milliseconds.
  /// Minute 0 is 32 minutes ago, so a running turn's "Working for" reads like a real one.
  private static func t(_ minutes: Double) -> Double {
    let start = (Date().timeIntervalSince1970 / 60).rounded(.down) - 32
    return (start + minutes) * 60_000
  }

  private static func user(_ id: String, _ minute: Double, _ text: String) -> [String: Any] {
    ["id": id, "role": "user", "text_blocks": [text], "tool_calls": [], "timestamp": t(minute)]
  }

  private static func assistant(
    _ id: String, _ minute: Double, text: [String] = [], calls: [[String: Any]] = []
  ) -> [String: Any] {
    ["id": id, "role": "assistant", "text_blocks": text, "tool_calls": calls, "timestamp": t(minute)]
  }

  private static func call(
    _ id: String, _ name: String, _ input: [String: Any], output: String? = nil, error: Bool = false,
    status: String? = nil, children: [[String: Any]]? = nil, background: [String: Any]? = nil
  ) -> [String: Any] {
    var raw: [String: Any] = [
      "id": id, "name": name, "input": input,
      "result_blocks": output.map { [["type": "text", "text": $0]] } ?? [],
      "status": status ?? (error ? "error" : "done"),
    ]
    if error { raw["is_error"] = true }
    if let children { raw["children"] = children }
    if let background { raw["background"] = background }
    return raw
  }
}
