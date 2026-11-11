import Foundation

/// The `.command` transcript: a ticket started with Argus's `/implement-ticket`,
/// then the runner's own `/compact`.
extension GalleryFixtures {
  /// The message whose playbook the "command-playbook" stories open.
  public static let commandMessageId = "c1"

  static var commandChat: [[String: Any]] {
    [
      [
        "id": commandMessageId, "role": "user", "tool_calls": [], "timestamp": minutes(0),
        "text_blocks": ["/implement-ticket ENG-273\n\nKeep the old header on iPad — design says it stays for now."],
        "command": [
          "name": "implement-ticket", "kind": "argus", "argument": "ENG-273",
          "notes": "Keep the old header on iPad — design says it stays for now.", "prompt": implementTicketPrompt,
        ],
      ],
      [
        "id": "c2", "role": "assistant", "timestamp": minutes(1),
        "text_blocks": [
          "ENG-273 asks for the session tabs to wrap instead of scrolling, with four acceptance criteria and two Figma frames. Starting with a baseline on the iPhone and the iPad."
        ],
        "tool_calls": [
          [
            "id": "c2a", "name": "mcp__argus__linear_get_issue", "input": ["issue": "ENG-273"], "status": "done",
            "result_blocks": [["type": "text", "text": "ENG-273 · Wrap the session tabs"]],
          ]
        ],
      ],
      [
        "id": "c3", "role": "user", "tool_calls": [], "timestamp": minutes(24),
        "text_blocks": ["/compact keep the criteria and the evidence paths"],
        "command": ["name": "compact", "kind": "runner", "notes": "keep the criteria and the evidence paths"],
      ],
      [
        "id": "c4", "role": "assistant", "timestamp": minutes(25), "tool_calls": [],
        "text_blocks": [
          "Compacted. Criteria 1–3 pass on both devices with evidence in `.argus/verify/ENG-273/evidence/`; criterion 4 is next."
        ],
      ],
    ]
  }

  /// Like the other transcripts, the chat ends a few minutes ago.
  private static func minutes(_ m: Double) -> Double {
    ((Date().timeIntervalSince1970 / 60).rounded(.down) - 32 + m) * 60_000
  }

  private static let implementTicketPrompt = """
    # Implement ENG-273, and prove it

    You are done only when every acceptance criterion has evidence taken after your last code change and every check passes after your last code change. Keep your notes, specs and evidence in `.argus/verify/ENG-273/` (Argus keeps it out of git).

    ## 1. Read the ticket

    Call `linear_get_issue` with `ENG-273`: description, comments and attached screenshots. Write every item under its expected behaviour or acceptance criteria to `.argus/verify/ENG-273/criteria.md`, numbered, one observable behaviour per line.

    ## 2. Extract every design up front

    Collect every Figma link in the ticket and its comments. For each link, `figma_get_frame`, then save its spec and image under `.argus/verify/ENG-273/figma/`.

    ## 3. Get the devices ready

    Verify on the device(s) already reserved for or handed to you (`conductor workspace info`). Start the app with `trigger_run` (configured: `Mac app`) and wait for it with `wait_for_terminal` — never from Bash.

    ## 6. Verify every criterion

    For each criterion, on every device:
    - Drive it with conductor as a user would (`tap-on`, `input-text`, `swipe`, …).
    - Confirm the result from `conductor capture-ui` — not from reading the code.
    - Save a screenshot to `.argus/verify/ENG-273/evidence/<criterion>-<device>.png`.

    ## 7. Checks

    Run each from the worktree root; every one must pass:
    - `pnpm lint`
    - `swift test`

    ## From the user

    Keep the old header on iPad — design says it stays for now.
    """
}
