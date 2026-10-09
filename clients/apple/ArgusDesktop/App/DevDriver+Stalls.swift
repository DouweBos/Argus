#if DEBUG
  import AppKit

  /// `stallsStart` / `stalls`: a 5 ms main-thread heartbeat, to time how long a
  /// screen switch keeps the main thread from drawing. `stalls` answers the
  /// longest gap and the total of gaps over 50 ms since the last call, then resets.
  /// `switchPanel` (`panel`): what the toolbar switcher does, for the session on screen.
  /// `repoState`: what the session's repository has loaded so far.
  @MainActor
  enum StallDriver {
    private static var timer: Timer?
    private static var last = CACurrentMediaTime()
    private static var longest: Double = 0
    private static var stalled: Double = 0

    static func run(_ command: [String: Any]) -> [String: Any]? {
      switch command["op"] as? String {
      case "stallsStart":
        if timer == nil {
          let timer = Timer(timeInterval: 0.005, repeats: true) { _ in
            MainActor.assumeIsolated { tick() }
          }
          RunLoop.main.add(timer, forMode: .common)
          self.timer = timer
        }
        reset()
        return ["ok": true]
      case "stalls":
        tick()
        defer { reset() }
        return ["longestMs": Int(longest * 1000), "stalledMs": Int(stalled * 1000)]
      case "switchPanel":
        guard let model = AppDelegate.current?.model,
          let panel = (command["panel"] as? String).flatMap(SessionPanel.init(rawValue:))
        else { return ["error": "panel?"] }
        model.show(panel, via: .toolbar)
        return ["route": "\(model.route)"]
      case "repoState":
        // The session on screen's repository: whether it's open and what has loaded.
        guard let model = AppDelegate.current?.model, let id = model.route.sessionId else {
          return ["error": "no session"]
        }
        guard let workspace = model.git.workspace(id) else { return ["open": false] }
        return [
          "open": true, "tags": workspace.refs.tags.count, "branches": workspace.refs.localBranches.count,
          "stashes": workspace.stashes.stashes.count, "changed": workspace.workingCopy.changedCount,
        ]
      default:
        return nil
      }
    }

    private static func tick() {
      let now = CACurrentMediaTime()
      let gap = now - last
      last = now
      longest = max(longest, gap)
      if gap > 0.05 { stalled += gap }
    }

    private static func reset() {
      last = CACurrentMediaTime()
      longest = 0
      stalled = 0
    }
  }
#endif
