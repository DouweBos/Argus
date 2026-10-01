#if DEBUG
  import AppKit

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
      timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.poll() }
      }
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
      case "key":
        return ["ok": key(command["key"] as? String ?? "", mods: command["mods"] as? [String] ?? [], in: window)]
      case "type":
        guard let text = command["text"] as? String,
          let input = window.firstResponder as? NSTextInputClient
        else { return ["error": "no text input focused"] }
        input.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))
        return ["ok": true]
      case "menu":
        guard let title = command["title"] as? String, let item = menuItem(title, in: NSApp.mainMenu)
        else { return ["error": "no menu item"] }
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

    private func click(at point: NSPoint, in window: NSWindow, count: Int = 1) -> Bool {
      for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
        guard
          let event = NSEvent.mouseEvent(
            with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: count,
            pressure: type == .leftMouseDown ? 1 : 0)
        else { return false }
        window.sendEvent(event)
      }
      return true
    }

    private func key(_ key: String, mods: [String], in window: NSWindow) -> Bool {
      var flags: NSEvent.ModifierFlags = []
      if mods.contains("cmd") { flags.insert(.command) }
      if mods.contains("shift") { flags.insert(.shift) }
      if mods.contains("option") { flags.insert(.option) }
      if mods.contains("control") { flags.insert(.control) }
      let named: [String: (String, UInt16)] = [
        "return": ("\r", 36), "escape": ("\u{1b}", 53), "tab": ("\t", 48),
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

    private func menuItem(_ title: String, in menu: NSMenu?) -> NSMenuItem? {
      for item in menu?.items ?? [] {
        if item.title == title { return item }
        if let found = menuItem(title, in: item.submenu) { return found }
      }
      return nil
    }
  }
#endif
