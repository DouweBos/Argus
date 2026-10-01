#if DEBUG
  import AppKit
  import UserNotifications

  /// Drives this app's own window from JSON files, so a dev build can be
  /// exercised without UI scripting — which would also reach whatever else is
  /// running on the machine. Everything happens in-process: events are handed
  /// to our window and nothing is activated or brought forward.
  ///
  /// `ARGUS_DEV_DRIVER=<dir>`: each `cmd-<n>.json` is run once and answered in
  /// `out-<n>.json`. Ops: `tree`, `press` / `click` (by accessibility label or
  /// title, optional `index`), `key` (`key`, `mods`), `type` (`text`), `menu`
  /// (`title`).
  @MainActor
  final class DevDriver {
    private let dir: URL
    private var timer: Timer?
    /// The menu being tracked right now, if a click opened one.
    private var trackedMenu: NSMenu?
    private var menuObservers: [NSObjectProtocol] = []

    static func startIfConfigured() -> DevDriver? {
      guard let path = ProcessInfo.processInfo.environment["ARGUS_DEV_DRIVER"] else { return nil }
      let driver = DevDriver(dir: URL(fileURLWithPath: path))
      driver.start()
      return driver
    }

    private init(dir: URL) {
      self.dir = dir
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private func start() {
      let center = NotificationCenter.default
      menuObservers.append(
        center.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: nil) {
          [weak self] note in
          // Posted on the main thread, by the menu that just opened.
          nonisolated(unsafe) let menu = note.object as? NSMenu
          MainActor.assumeIsolated { self?.trackedMenu = menu }
        })
      menuObservers.append(
        center.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: nil) {
          [weak self] _ in
          MainActor.assumeIsolated { self?.trackedMenu = nil }
        })
      let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.poll() }
      }
      // Common modes, so commands still run while a menu is tracking.
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
    }

    private var window: NSWindow? {
      NSApp.windows.first { $0.isVisible && $0.contentView != nil && $0.title == "Argus" }
        ?? NSApp.windows.first { $0.isVisible && $0.attachedSheet == nil && $0.contentView != nil }
    }

    /// The window a command acts on: a sheet when one is up, else the main one.
    private var target: NSWindow? {
      window?.attachedSheet ?? window
    }

    private func poll() {
      let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
      for name in files.sorted() where name.hasPrefix("cmd-") && name.hasSuffix(".json") {
        let url = dir.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url),
          let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { continue }
        try? FileManager.default.removeItem(at: url)
        let result = run(command)
        let out = dir.appendingPathComponent(name.replacingOccurrences(of: "cmd-", with: "out-"))
        if let json = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted]) {
          try? json.write(to: out)
        }
      }
    }

    private func run(_ command: [String: Any]) -> [String: Any] {
      guard let window = target else { return ["error": "no window"] }
      switch command["op"] as? String {
      case "tree":
        return ["tree": describe(window, depth: 0)]
      case "press", "click":
        guard let label = command["label"] as? String else { return ["error": "label?"] }
        let matches = find(label, in: window, exact: command["exact"] as? Bool ?? false)
        let index = command["index"] as? Int ?? 0
        guard matches.indices.contains(index) else {
          return ["error": "no element '\(label)'", "found": matches.count]
        }
        let element = matches[index]
        if command["op"] as? String == "press" {
          return ["ok": element.accessibilityPerformPress()]
        }
        return ["ok": click(element, in: window)]
      case "clickAt":
        // Top-left window coordinates, as in a screenshot of the window.
        guard let x = command["x"] as? Double, let y = command["y"] as? Double else {
          return ["error": "x, y?"]
        }
        let point = NSPoint(x: x, y: window.frame.height - y)
        return ["ok": click(at: point, in: window, count: command["count"] as? Int ?? 1)]
      case "rightClickAt":
        guard let x = command["x"] as? Double, let y = command["y"] as? Double,
          let event = NSEvent.mouseEvent(
            with: .rightMouseDown, location: NSPoint(x: x, y: window.frame.height - y),
            modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
            pressure: 1)
        else { return ["error": "x, y?"] }
        window.sendEvent(event)
        return ["ok": true]
      case "key":
        return ["ok": key(command["key"] as? String ?? "", mods: command["mods"] as? [String] ?? [], in: window)]
      case "type":
        guard let text = command["text"] as? String,
          let input = window.firstResponder as? NSTextInputClient
        else { return ["error": "no text input focused"] }
        input.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))
        return ["ok": true]
      case "link", "select":
        // By content: SwiftUI positions these text views with layer offsets,
        // so window coordinates can't find them reliably.
        guard let needle = command["text"] as? String, let content = window.contentView,
          let text = textViews(in: content).first(where: { $0.string.contains(needle) })
        else { return ["error": "no text view shows that text"] }
        let range = (text.string as NSString).range(of: needle)
        if command["op"] as? String == "select" {
          guard text.isSelectable else { return ["error": "not selectable"] }
          text.setSelectedRange(range)
          return ["selection": (text.string as NSString).substring(with: text.selectedRange())]
        }
        guard let link = text.textStorage?.attribute(.link, at: range.location, effectiveRange: nil)
        else { return ["error": "no link on that text"] }
        let handled = text.delegate?.textView?(text, clickedOnLink: link, at: range.location) ?? false
        return ["ok": handled, "link": "\(link)"]
      case "menuItems":
        guard let menu = trackedMenu else { return ["error": "no menu open"] }
        return ["items": menu.items.map { ($0.state == .on ? "✓ " : "") + $0.title }]
      case "menuPick", "menuCancel":
        guard let menu = trackedMenu else { return ["error": "no menu open"] }
        if command["op"] as? String == "menuCancel" {
          menu.cancelTracking()
          return ["ok": true]
        }
        guard let title = command["title"] as? String,
          let index = menu.items.firstIndex(where: { $0.title == title })
        else { return ["error": "no such item", "items": menu.items.map(\.title)] }
        menu.cancelTracking()
        menu.performActionForItem(at: index)
        return ["ok": true]
      case "dropFiles":
        // A drag onto the chat input from a private pasteboard: the general
        // one belongs to whoever is using this machine.
        guard let paths = command["paths"] as? [String], let content = window.contentView,
          let input = textViews(in: content).last(where: { $0.isEditable && !$0.isFieldEditor })
        else { return ["error": "paths? / no input"] }
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("argus-dev-drop"))
        pasteboard.clearContents()
        pasteboard.writeObjects(paths.map { URL(fileURLWithPath: $0) as NSURL })
        let info = FakeDraggingInfo(pasteboard: pasteboard, window: window)
        _ = input.draggingEntered(info)
        return ["ok": input.performDragOperation(info)]
      case "deleteSession":
        AppDelegate.current?.model.requestDeleteSession()
        return ["ok": AppDelegate.current?.model.deletingSession != nil]
      case "newSession":
        // What ⌘N does; SwiftUI only enables menu commands while the app is active.
        AppDelegate.current?.model.requestNewSession()
        return ["ok": true]
      case "notifications":
        // Read-only: what macOS allows this app, and what it has delivered.
        let semaphore = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var result: [String: Any] = [:]
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          result["authorization"] = settings.authorizationStatus.rawValue
          result["alertStyle"] = settings.alertStyle.rawValue
          UNUserNotificationCenter.current().getDeliveredNotifications { delivered in
            result["delivered"] = delivered.map { $0.request.content.title }
            semaphore.signal()
          }
        }
        _ = semaphore.wait(timeout: .now() + 2)
        return result
      case "state":
        let model = AppDelegate.current?.model
        let item = menuItem("New Session…", in: NSApp.mainMenu)
        item?.menu?.update()
        return [
          "projects": model?.store.projects.count ?? -1,
          "route": "\(model.map { $0.route } as Any)",
          "newSessionEnabled": item?.isEnabled ?? false,
          "newSessionTarget": "\(item?.target as Any)",
          "sheet": window.attachedSheet != nil,
        ]
      case "focus":
        // The chat input: the one editable text view outside the find bar.
        guard let content = window.contentView,
          let input = textViews(in: content).last(where: { $0.isEditable && !$0.isFieldEditor })
        else { return ["error": "no editable text view"] }
        return ["ok": window.makeFirstResponder(input)]
      case "textViews":
        guard let content = window.contentView else { return [:] }
        return ["views": textViews(in: content).map {
          "\(Int($0.convert($0.bounds, to: nil).minX)),\(Int($0.convert($0.bounds, to: nil).minY)) \(Int($0.bounds.width))x\(Int($0.bounds.height)) vis=\(Int($0.visibleRect.height)) flipped=\($0.isFlipped) \($0.string.prefix(30))"
        }]
      case "selection":
        guard let text = window.firstResponder as? NSTextView else { return ["error": "no text view focused"] }
        let selected = text.selectedRanges.map { (text.string as NSString).substring(with: $0.rangeValue) }
        return ["selection": selected.joined(separator: "\n")]
      case "menu":
        guard let title = command["title"] as? String, let item = menuItem(title, in: NSApp.mainMenu)
        else { return ["error": "no menu item"] }
        // Validation normally runs when the menu opens; nothing opened it here.
        item.menu?.update()
        guard item.isEnabled, let action = item.action else { return ["error": "disabled"] }
        return ["ok": NSApp.sendAction(action, to: item.target, from: item)]
      default:
        return ["error": "unknown op"]
      }
    }

    // MARK: Accessibility

    private func label(of element: NSAccessibilityProtocol) -> String {
      let parts = [
        element.accessibilityLabel(),
        element.accessibilityTitle(),
        element.accessibilityValue() as? String,
      ]
      return parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " | ")
    }

    private func children(of element: Any?) -> [NSAccessibilityProtocol] {
      ((element as AnyObject?)?.accessibilityChildren?() ?? nil)?
        .compactMap { $0 as? NSAccessibilityProtocol } ?? []
    }

    private func describe(_ element: Any?, depth: Int) -> [[String: Any]] {
      guard depth < 40 else { return [] }
      return children(of: element).map { child in
        let object = child as AnyObject
        let frame = object.accessibilityFrame?() ?? .zero
        var node: [String: Any] = [
          "role": (object.accessibilityRole?() ?? nil)?.rawValue ?? "",
          "label": label(of: child),
          "frame": [frame.origin.x, frame.origin.y, frame.width, frame.height].map { Int($0) },
        ]
        let kids = describe(child, depth: depth + 1)
        if !kids.isEmpty { node["children"] = kids }
        return node
      }
    }

    private func find(_ text: String, in element: Any?, exact: Bool) -> [NSAccessibilityProtocol] {
      var found: [NSAccessibilityProtocol] = []
      for child in children(of: element) {
        let name = label(of: child)
        if exact ? name == text : name.localizedCaseInsensitiveContains(text) {
          found.append(child)
        }
        found += find(text, in: child, exact: exact)
      }
      return found
    }

    // MARK: Events

    /// A real mouse down/up at the element's centre, delivered to our window
    /// only — the same hit-testing path a click takes.
    private func click(_ element: NSAccessibilityProtocol, in window: NSWindow) -> Bool {
      let frame = (element as AnyObject).accessibilityFrame?() ?? .zero
      guard frame != .zero else { return false }
      let screenPoint = NSPoint(x: frame.midX, y: frame.midY)
      return click(at: window.convertPoint(fromScreen: screenPoint), in: window)
    }

    /// Through the window, the way AppKit routes a real click — SwiftUI's
    /// gestures only see events that arrive that way. A window that isn't key
    /// doesn't activate the app for an in-process event, so focus stays put.
    private func click(at point: NSPoint, in window: NSWindow, count: Int = 1) -> Bool {
      func event(_ type: NSEvent.EventType) -> NSEvent? {
        NSEvent.mouseEvent(
          with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: count,
          pressure: type == .leftMouseDown ? 1 : 0)
      }
      guard let down = event(.leftMouseDown), let up = event(.leftMouseUp) else { return false }
      // Views that track the mouse (text views, buttons) pull the up from the
      // queue while handling the down, so it has to be waiting there first.
      NSApp.postEvent(up, atStart: false)
      window.sendEvent(down)
      return true
    }

    private func key(_ key: String, mods: [String], in window: NSWindow) -> Bool {
      var flags: NSEvent.ModifierFlags = []
      if mods.contains("cmd") { flags.insert(.command) }
      if mods.contains("shift") { flags.insert(.shift) }
      if mods.contains("option") { flags.insert(.option) }
      if mods.contains("control") { flags.insert(.control) }
      let named: [String: (String, UInt16)] = [
        "return": ("\r", 36), "escape": ("\u{1b}", 53), "tab": ("\t", 48), "delete": ("\u{7f}", 51),
        "down": (String(UnicodeScalar(NSDownArrowFunctionKey)!), 125),
        "up": (String(UnicodeScalar(NSUpArrowFunctionKey)!), 126),
      ]
      let (characters, code) = named[key] ?? (key, 0)
      for type in [NSEvent.EventType.keyDown, .keyUp] {
        guard
          let event = NSEvent.keyEvent(
            with: type, location: .zero, modifierFlags: flags,
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, characters: characters, charactersIgnoringModifiers: characters,
            isARepeat: false, keyCode: code)
        else { return false }
        // Key equivalents (⌘F, ⌘G) go through the menu and the view tree
        // first, the way the app would route them.
        if type == .keyDown, !flags.isEmpty,
          NSApp.mainMenu?.performKeyEquivalent(with: event) == true || window.performKeyEquivalent(with: event)
        {
          return true
        }
        window.sendEvent(event)
      }
      return true
    }

    private func textViews(in view: NSView) -> [NSTextView] {
      (view as? NSTextView).map { [$0] } ?? view.subviews.flatMap { textViews(in: $0) }
    }

    private func menuItem(_ title: String, in menu: NSMenu?) -> NSMenuItem? {
      for item in menu?.items ?? [] {
        if item.title == title { return item }
        if let found = menuItem(title, in: item.submenu) { return found }
      }
      return nil
    }
  }



  /// Just enough of a drag for a drop target to read its pasteboard.
  @MainActor final class FakeDraggingInfo: NSObject, @preconcurrency NSDraggingInfo {
    let draggingPasteboard: NSPasteboard
    let draggingDestinationWindow: NSWindow?
    init(pasteboard: NSPasteboard, window: NSWindow) {
      draggingPasteboard = pasteboard
      draggingDestinationWindow = window
    }
    var draggingSourceOperationMask: NSDragOperation { .copy }
    var draggingLocation: NSPoint { .zero }
    var draggedImageLocation: NSPoint { .zero }
    var draggedImage: NSImage? { nil }
    var draggingSource: Any? { nil }
    var draggingSequenceNumber: Int { 1 }
    func slideDraggedImage(to screenPoint: NSPoint) {}
    var draggingFormation: NSDraggingFormation = .default
    var animatesToDestination = false
    var numberOfValidItemsForDrop = 1
    func enumerateDraggingItems(
      options enumOpts: NSDraggingItemEnumerationOptions = [], for view: NSView?,
      classes classArray: [AnyClass], searchOptions: [NSPasteboard.ReadingOptionKey: Any] = [:],
      using block: (NSDraggingItem, Int, UnsafeMutablePointer<ObjCBool>) -> Void
    ) {}
    var springLoadingHighlight: NSSpringLoadingHighlight { .none }
    func resetSpringLoading() {}
  }
#endif
