#if DEBUG
  import AppKit
  import ArgusCore
  import QuartzCore

  /// Dev-driver ops that use the transcript the way a hand does, all through
  /// our own window's event path. Coordinates are top-left window points, as
  /// in a `snapshot`.
  ///
  /// - `agentFixture` (`session`, `count`): the fixture in the main window's agent pane.
  /// - `tRows`: the rows on screen, with their ids and frames.
  /// - `tText` (`text`, `occurrence`): where a string sits in a transcript text view.
  /// - `drag` (`x1`, `y1`, `x2`, `y2`, `steps`, `mods`): a press, drag and release.
  /// - `hover` (`x`, `y`): a mouse move there, answering with the cursor it left.
  /// - `pasteboard`: what the transcript last copied, from its private pasteboard.
  /// - `tProbe` (`action`: `start` | `stop`, `out`): every frame, where each row on
  ///   screen sits, and how far rows moved beyond what the wheel asked for.
  /// - `tScrollTo` (`row`): a row id at the top of the viewport.
  @MainActor
  enum TranscriptInputDriver {
    /// Pixel deltas the wheel bench sent, for the probe to subtract.
    static var sentDelta: Double = 0
    private static var probe: FrameProbe?

    static func run(_ command: [String: Any], window: NSWindow) -> [String: Any]? {
      switch command["op"] as? String {
      case "agentFixture":
        guard let model = AppDelegate.current?.model, let session = command["session"] as? String else {
          return ["error": "session?"]
        }
        let count = command["count"] as? Int ?? 600
        let (messages, images) = TranscriptDriver.prepared[count] ?? TranscriptDriver.prepare(count)
        TranscriptDriver.prepared[count] = (messages, images)
        let key = command["agent"] as? String ?? "fixture-agent"
        for (id, data) in images {
          model.store.seedImage(agentId: key, imageId: id, dataURI: "data:image/png;base64,\(data)")
        }
        TranscriptStress.fixture = messages
        model.open(spawned: key, session: session)
        return ["ok": true, "messages": messages.count]
      case "pretendActive":
        // This process alone believes it is the active app with a key window, so
        // clicks can take the queue path a real one does without activating anything.
        FakeFocus.install()
        return ["ok": true, "active": NSApp.isActive, "key": window.isKeyWindow]
      case "tRows":
        guard let (scroll, table) = transcript(in: window) else { return ["error": "no transcript"] }
        let visible = table.rows(in: scroll.contentView.bounds)
        let controller = table.delegate as? TranscriptTableController
        return [
          "rows": (visible.location..<(visible.location + visible.length)).map { index -> [String: Any] in
            let rect = topLeft(table.convert(table.rect(ofRow: index), to: nil), in: window)
            let cell = table.view(atColumn: 0, row: index, makeIfNecessary: false)
            return [
              "index": index, "id": controller?.id(index) ?? "", "x": rect.minX, "y": rect.minY,
              "h": rect.height, "cell": cell.map { "\(type(of: $0))" } ?? "-",
            ]
          },
          "offset": scroll.contentView.bounds.minY,
        ]
      case "tText":
        guard let needle = command["text"] as? String, let content = window.contentView else {
          return ["error": "text?"]
        }
        let views = textViews(in: content).filter { $0.string.contains(needle) && $0.visibleRect.height > 0 }
        let index = command["occurrence"] as? Int ?? 0
        guard views.indices.contains(index) else { return ["error": "not on screen", "found": views.count] }
        let view = views[index]
        let range = (view.string as NSString).range(of: needle)
        guard let first = view.rect(forCharacter: range.location),
          let last = view.rect(forCharacter: range.location + range.length - 1)
        else { return ["error": "no layout"] }
        let a = topLeft(view.convert(first, to: nil), in: window)
        let b = topLeft(view.convert(last, to: nil), in: window)
        return [
          "x1": a.minX + 1, "y1": a.midY, "x2": b.maxX - 1, "y2": b.midY,
          "selectable": view.isSelectable, "length": (view.string as NSString).length,
        ]
      case "drag":
        guard let x1 = command["x1"] as? Double, let y1 = command["y1"] as? Double,
          let x2 = command["x2"] as? Double, let y2 = command["y2"] as? Double
        else { return ["error": "x1, y1, x2, y2?"] }
        let steps = command["steps"] as? Int ?? 8
        let flags: NSEvent.ModifierFlags = (command["mods"] as? [String] ?? []).contains("shift") ? .shift : []
        let start = point(x1, y1, in: window)
        let end = point(x2, y2, in: window)
        // The tracking loop pulls drags and the release off the queue, so they wait there first.
        for step in 1...steps {
          let t = CGFloat(step) / CGFloat(steps)
          let at = NSPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)
          if let event = mouse(.leftMouseDragged, at: at, in: window, flags: flags) { NSApp.postEvent(event, atStart: false) }
        }
        if let up = mouse(.leftMouseUp, at: end, in: window, flags: flags) { NSApp.postEvent(up, atStart: false) }
        guard let down = mouse(.leftMouseDown, at: start, in: window, flags: flags) else { return ["error": "event"] }
        window.sendEvent(down)
        return ["ok": true]
      case "hover":
        guard let x = command["x"] as? Double, let y = command["y"] as? Double,
          let event = mouse(.mouseMoved, at: point(x, y, in: window), in: window, flags: [])
        else { return ["error": "x, y?"] }
        var at = window.contentView?.superview?.hitTest(event.locationInWindow)
        while let view = at, !(view is TranscriptNSTextView), let parent = view.superview { at = parent }
        at?.mouseMoved(with: event)
        let cursor = NSCursor.current
        let name =
          cursor == .pointingHand ? "pointingHand" : cursor == .iBeam ? "iBeam" : cursor == .arrow ? "arrow" : "other"
        return ["cursor": name, "view": at.map { "\(type(of: $0))" } ?? "-"]
      case "action":
        // An edit action (`copy:`, `selectAll:`) to the first responder, as its
        // menu item sends it; menus validate against a key window this app never has.
        guard let name = command["selector"] as? String, let responder = window.firstResponder else {
          return ["error": "selector? / no responder"]
        }
        return ["ok": NSApp.sendAction(Selector(name), to: responder, from: nil), "to": "\(type(of: responder))"]
      case "wheel":
        // A trackpad-precise wheel event at a point, through the transcript's
        // wheel monitor as a real one passes, then the window.
        guard let x = command["x"] as? Double, let y = command["y"] as? Double,
          let cg = CGEvent(
            scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
            wheel1: Int32(command["dy"] as? Int ?? 0), wheel2: Int32(command["dx"] as? Int ?? 0), wheel3: 0)
        else { return ["error": "x, y?"] }
        cg.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        cg.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: command["dy"] as? Double ?? 0)
        cg.setDoubleValueField(.scrollWheelEventPointDeltaAxis2, value: command["dx"] as? Double ?? 0)
        let screenHeight = NSScreen.screens.first?.frame.height ?? 0
        cg.location = CGPoint(x: x, y: screenHeight - (window.frame.height - y))
        guard let event = NSEvent(cgEvent: cg) else { return ["error": "event"] }
        if let scroll = TranscriptDriver.transcriptScrollView(in: window) as? TranscriptScrollView,
          scroll.takeWheel(event)
        {
          return ["ok": true, "redirected": true]
        }
        window.sendEvent(event)
        return ["ok": true, "redirected": false]
      case "tCode":
        // Each code block on screen: its sideways scroll position and sizes.
        func blocks(_ view: NSView) -> [TranscriptCodeBlockView] {
          (view as? TranscriptCodeBlockView).map { [$0] } ?? view.subviews.flatMap(blocks)
        }
        return [
          "blocks": (window.contentView.map(blocks) ?? []).filter { $0.visibleRect.height > 0 }.map { block in
            let scroll = block.text.enclosingScrollView
            return [
              "text": String(block.text.string.prefix(24)), "x": scroll?.contentView.bounds.minX ?? -1,
              "document": block.text.frame.width, "clip": scroll?.contentView.bounds.width ?? -1,
              "height": block.frame.height, "scroller": scroll?.horizontalScroller?.isHidden == false,
            ] as [String: Any]
          }
        ]
      case "pasteboard":
        return ["string": TranscriptSystem.pasteboard.string(forType: .string) ?? NSNull()]
      case "clearPasteboard":
        TranscriptSystem.pasteboard.clearContents()
        return ["ok": true]
      case "firstResponder":
        let responder = window.firstResponder
        let text = responder as? NSTextView
        return [
          "type": responder.map { "\(type(of: $0))" } ?? "-",
          "selection": text.map { view in
            view.selectedRanges.map { (view.string as NSString).substring(with: $0.rangeValue) }.joined(separator: "|")
          } ?? NSNull(),
        ]
      case "tProbe":
        if command["action"] as? String == "start" {
          guard let (scroll, table) = transcript(in: window) else { return ["error": "no transcript"] }
          probe = FrameProbe(scroll: scroll, table: table)
          return ["ok": true]
        }
        guard let report = probe?.stop() else { return ["error": "not probing"] }
        probe = nil
        if let out = command["out"] as? String { TranscriptDriver.write(report, to: out) }
        return report.filter { $0.key != "frames" }
      case "tBottom":
        guard let (_, table) = transcript(in: window), let controller = table.delegate as? TranscriptTableController
        else { return ["error": "no transcript"] }
        controller.jumpToLatest()
        return ["ok": true]
      case "tScrollTo":
        guard let (scroll, table) = transcript(in: window),
          let controller = table.delegate as? TranscriptTableController, let row = command["row"] as? String,
          let index = (0..<table.numberOfRows).first(where: { controller.id($0) == row })
        else { return ["error": "row?"] }
        controller.follow.atBottom = false
        let limit = max(0, table.frame.height - scroll.contentView.bounds.height)
        scroll.contentView.scroll(to: NSPoint(x: 0, y: min(table.rect(ofRow: index).minY, limit)))
        scroll.reflectScrolledClipView(scroll.contentView)
        return ["ok": true]
      default:
        return nil
      }
    }

    static func transcript(in window: NSWindow) -> (NSScrollView, NSTableView)? {
      guard let scroll = TranscriptDriver.transcriptScrollView(in: window),
        let table = scroll.documentView as? NSTableView
      else { return nil }
      return (scroll, table)
    }

    private static func point(_ x: Double, _ y: Double, in window: NSWindow) -> NSPoint {
      NSPoint(x: x, y: window.frame.height - y)
    }

    private static func topLeft(_ rect: NSRect, in window: NSWindow) -> NSRect {
      NSRect(x: rect.minX, y: window.frame.height - rect.maxY, width: rect.width, height: rect.height)
    }

    private static func mouse(
      _ type: NSEvent.EventType, at point: NSPoint, in window: NSWindow, flags: NSEvent.ModifierFlags
    ) -> NSEvent? {
      NSEvent.mouseEvent(
        with: type, location: point, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
        pressure: type == .leftMouseUp ? 0 : 1)
    }

    private static func textViews(in view: NSView) -> [NSTextView] {
      (view as? NSTextView).map { [$0] } ?? view.subviews.flatMap { textViews(in: $0) }
    }
  }

  /// Swaps `isActive` / `isKeyWindow` for always-true versions, in this debug process only.
  @MainActor
  enum FakeFocus {
    private static var installed = false

    static func install() {
      guard !installed else { return }
      installed = true
      swap(NSApplication.self, #selector(getter: NSApplication.isActive), #selector(NSApplication.argusFakeActive))
      swap(NSWindow.self, #selector(getter: NSWindow.isKeyWindow), #selector(NSWindow.argusFakeKey))
    }

    private static func swap(_ type: AnyClass, _ original: Selector, _ replacement: Selector) {
      guard let a = class_getInstanceMethod(type, original), let b = class_getInstanceMethod(type, replacement)
      else { return }
      method_exchangeImplementations(a, b)
    }
  }

  extension NSApplication {
    @objc fileprivate func argusFakeActive() -> Bool { true }
  }

  extension NSWindow {
    /// The main window and the fixture windows count as key; panels and menus keep their own answer.
    @objc fileprivate func argusFakeKey() -> Bool { isVisible && canBecomeKey && !(self is NSPanel) }
  }

  extension NSTextView {
    /// A character's glyph rect in this view's coordinates.
    fileprivate func rect(forCharacter index: Int) -> NSRect? {
      guard let layout = textLayoutManager, let manager = layout.textContentManager,
        let start = manager.location(manager.documentRange.location, offsetBy: index),
        let end = manager.location(start, offsetBy: 1), let range = NSTextRange(location: start, end: end)
      else { return nil }
      var found: NSRect?
      layout.enumerateTextSegments(in: range, type: .standard, options: []) { _, frame, _, _ in
        found = frame
        return false
      }
      return found.map { $0.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y) }
    }
  }

  /// Every frame: each visible row's distance from the viewport's top. A row
  /// on screen in two frames running should have moved by exactly what the
  /// wheel sent between them; anything else is the transcript jumping.
  @MainActor
  final class FrameProbe {
    private let scroll: NSScrollView
    private let table: NSTableView
    private var timer: Timer?
    private var last: [String: CGFloat] = [:]
    private var lastSent: Double = 0
    private var frames: [[String: Any]] = []
    private var jumps: [[String: Any]] = []
    private var count = 0
    private let began = CACurrentMediaTime()

    init(scroll: NSScrollView, table: NSTableView) {
      self.scroll = scroll
      self.table = table
      lastSent = TranscriptInputDriver.sentDelta
      let timer = Timer(timeInterval: 1.0 / 120, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.tick() }
      }
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
    }

    private func tick() {
      guard let controller = table.delegate as? TranscriptTableController else { return }
      let clip = scroll.contentView.bounds
      let visible = table.rows(in: clip)
      var now: [String: CGFloat] = [:]
      for index in visible.location..<(visible.location + visible.length) {
        now[controller.id(index)] = table.rect(ofRow: index).minY - clip.minY
      }
      let sent = TranscriptInputDriver.sentDelta - lastSent
      lastSent = TranscriptInputDriver.sentDelta
      let common = Set(now.keys).intersection(last.keys)
      // A positive wheel delta scrolls toward older rows, so rows move down by it.
      let moves = common.map { now[$0]! - last[$0]! }
      let atEdge = clip.minY <= 0.5 || clip.maxY >= table.frame.height - 0.5
      if let first = common.sorted().first, !atEdge {
        let jump = (now[first]! - last[first]!) - sent
        let spread = (moves.max() ?? 0) - (moves.min() ?? 0)
        if abs(jump) > 0.5 || spread > 0.5 {
          jumps.append([
            "t_ms": Stats.ms(CACurrentMediaTime() - began), "row": first, "jump": jump, "sent": sent,
            "spread": spread,
          ])
        }
      }
      count += 1
      if count % 12 == 0 || frames.count < 20 {
        let top = (0..<visible.length).first.map { controller.id(visible.location + $0) } ?? ""
        frames.append([
          "t_ms": Stats.ms(CACurrentMediaTime() - began), "top": top, "top_y": now[top] ?? 0,
          "offset": clip.minY, "content": table.frame.height,
        ])
      }
      last = now
    }

    func stop() -> [String: Any] {
      timer?.invalidate()
      timer = nil
      return [
        "frames_seen": count, "jumps": jumps.count, "worst_jump": jumps.map { abs($0["jump"] as? CGFloat ?? 0) }.max() ?? 0,
        "jump_samples": Array(jumps.prefix(20)), "frames": frames,
      ]
    }
  }
#endif
