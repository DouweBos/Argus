#if DEBUG
  import AppKit

  /// `stallsStart` / `stalls`: a 5 ms main-thread heartbeat, to time how long a
  /// screen switch keeps the main thread from drawing. `stalls` answers the
  /// longest gap and the total of gaps over 50 ms since the last call, then resets.
  /// `switchPanel` (`panel`): what the toolbar switcher does, for the session on screen.
  /// `repoState`: what the session's repository has loaded so far.
  /// `toolbarFrames`: the toolbar items' frames, to see the switcher keep its place.
  /// `resizeWindow` (`width`, `height`): the main window's content size.
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
      case "toolbarFrames":
        // Each toolbar item's frame in the window, left to right.
        guard let frame = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix("main") == true })?
          .contentView?.superview
        else { return ["error": "no window"] }
        return [
          "items": viewers(in: frame).map { "\(Int($0.minX))-\(Int($0.maxX))" },
          "width": Int(frame.bounds.width),
          "layout": (AppDelegate.current?.model).map { model -> String in
            let layout = model.toolbarLayout
            return "detail=\(Int(layout.detailWidth)) leading=\(Int(layout.leadingWidth)) "
              + "session=\(Int(layout.sessionToolsWidth)) panel=\(Int(layout.panelActionsWidth))"
          } ?? "",
        ]
      case "resizeWindow":
        // The main window's content width, to see the toolbar at a narrow and a wide window.
        guard let window = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix("main") == true }),
          let width = command["width"] as? Double
        else { return ["error": "width? / no window"] }
        let height = (command["height"] as? Double).map { CGFloat($0) } ?? window.contentLayoutRect.height
        window.setContentSize(NSSize(width: width, height: height))
        return ["ok": true, "frame": "\(window.frame)", "window": window.windowNumber]
      default:
        return nil
      }
    }

    private static func viewers(in view: NSView) -> [NSRect] {
      if NSStringFromClass(type(of: view)).contains("ToolbarItemViewer") {
        return view.isHidden || view.frame.width == 0 ? [] : [view.convert(view.bounds, to: nil)]
      }
      return view.subviews.flatMap(viewers).sorted { $0.minX < $1.minX }
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
