#if DEBUG
  import AppKit
  import ArgusCore
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
      NSApp.windows.first { $0.isVisible && $0.contentView != nil && $0.identifier?.rawValue.hasPrefix("main") == true }
        ?? NSApp.windows.first { $0.isVisible && $0.contentView != nil && $0.title == "Argus" }
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
      if command["op"] as? String == "windows" {
        return ["windows": NSApp.windows.map { "\($0.windowNumber) \($0.title) visible=\($0.isVisible) level=\($0.level.rawValue) \($0.frame)" }]
      }
      // `window`: a window number from `windows`, or a visible window's title
      // (a device popout), for windows that aren't sheets.
      let chosen = (command["window"] as? Int).flatMap { number in
        NSApp.windows.first { $0.windowNumber == number }
      } ?? (command["window"] as? String).flatMap { title in
        NSApp.windows.first { $0.isVisible && $0.title == title }
      }
      guard let window = chosen ?? target else { return ["error": "no window"] }
      switch command["op"] as? String {
      case "navigate":
        // What a sidebar click does, by session id.
        guard let model = AppDelegate.current?.model, let id = command["session"] as? String else {
          return ["error": "session?"]
        }
        // What a sidebar selection does; a list ignores clicks in a window
        // that isn't key, and a driven window never is.
        switch command["panel"] as? String {
        case "agents": model.navigate(.session(id: id, agentId: nil))
        case "home": model.navigate(.sessionHome(id: id))
        case "git":
          let view = (command["gitView"] as? String).flatMap(GitRoute.init(devString:)) ?? .working
          model.navigate(.sessionGit(id: id, view: view))
        default: model.open(session: id)
        }
        return ["ok": true, "route": "\(model.route)"]
      case "route":
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        switch command["to"] as? String {
        case "agents": model.navigate(.agents)
        case "runtimes": model.navigate(.runtimes)
        case "devices": model.navigate(.devices)
        case "pull-requests": model.navigate(.pullRequests)
        case "back": model.goBack()
        default: return ["error": "to?"]
        }
        return ["route": "\(model.route)"]
      case "cAddProject":
        // Add Project with the folder named, since an open panel can't be driven.
        guard let path = command["path"] as? String else { return ["error": "path?"] }
        NotificationCenter.default.post(name: .devAddProject, object: path)
        return ["ok": true]
      case "cProjectSettings":
        guard let model = AppDelegate.current?.model, let path = command["path"] as? String else {
          return ["error": "path?"]
        }
        model.projectSettingsRepo = path
        // A sidebar list ignores clicks in a window that isn't key; name the section.
        if let section = command["section"] as? String {
          NotificationCenter.default.post(name: .devProjectSection, object: section)
        }
        return ["ok": true]
      case "toggleTerminal":
        // What ⇧⌘T does; menu commands only enable while the app is active.
        AppDelegate.current?.model.terminalPanelVisible.toggle()
        return ["panel": AppDelegate.current?.model.terminalPanelVisible ?? false]
      case "terminals":
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        let tabs = model.terminals.tabsBySession.values.joined().map {
          "\($0.sessionId.prefix(8)) \($0.title) run=\($0.runTitle ?? "-") exit=\($0.exitCode.map(String.init) ?? "-")"
        }
        return [
          "tabs": tabs, "panel": model.terminalPanelVisible,
          "text": terminalText(in: window.contentView), "dryOpen": TerminalLinks.lastDryOpen ?? "",
        ]
      case "focusTerminal":
        guard let model = AppDelegate.current?.model, let sessionId = model.route.sessionId,
          let active = model.terminals.active(sessionId),
          let view = terminalViews(in: window.contentView).first(where: { $0.terminalId == active.id })
        else { return ["error": "no terminal"] }
        return ["ok": window.makeFirstResponder(view)]
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
        let count = command["count"] as? Int ?? 1
        let flags: NSEvent.ModifierFlags = (command["mods"] as? [String] ?? []).contains("cmd") ? .command : []
        if command["async"] as? Bool == true {
          // A click that opens a menu tracks until the menu closes; answer first.
          DispatchQueue.main.async { _ = self.click(at: point, in: window, count: count, flags: flags) }
          return ["ok": true]
        }
        return ["ok": click(at: point, in: window, count: count, flags: flags)]
      case "rightClickAt":
        guard let x = command["x"] as? Double, let y = command["y"] as? Double,
          let event = NSEvent.mouseEvent(
            with: .rightMouseDown, location: NSPoint(x: x, y: window.frame.height - y),
            modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
            pressure: 1)
        else { return ["error": "x, y?"] }
        // A context menu tracks until it closes; answer first.
        DispatchQueue.main.async { window.sendEvent(event) }
        return ["ok": true]
      case "key":
        return ["ok": key(command["key"] as? String ?? "", mods: command["mods"] as? [String] ?? [], code: command["code"] as? Int, in: window)]
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
      case "panelButton":
        // An AppKit button by title, e.g. in an alert sheet a synthetic click can't reach.
        guard let title = command["title"] as? String else { return ["error": "title?"] }
        func find(_ view: NSView) -> NSButton? {
          if let button = view as? NSButton, button.title == title { return button }
          return view.subviews.lazy.compactMap(find).first
        }
        guard let button = window.contentView.flatMap(find) else { return ["error": "no button '\(title)'"] }
        button.performClick(nil)
        return ["ok": true]
      case "settingsTab":
        // The Settings window's tab, by `SettingsTab` raw value.
        guard let tab = (command["tab"] as? String).flatMap(SettingsTab.init) else { return ["error": "tab?"] }
        AppDelegate.current?.model.settingsTab = tab
        return ["ok": true]
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
      case "sessions":
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        return [
          "sessions": model.store.sessionsByRepo.values.joined().map {
            ["id": $0.id, "kind": $0.kind.rawValue, "branch": $0.branch, "status": $0.status.rawValue]
          }
        ]
      case "registerProject":
        // What Add Project does once a folder is picked.
        guard let model = AppDelegate.current?.model, let backend = model.backend,
          let path = command["path"] as? String
        else { return ["error": "path? / no host"] }
        Task {
          _ = try? await backend.request(
            ArgusProtocol.Commands.AddRepoRoot.self, .init(path: path))
          await model.reload()
        }
        return ["ok": true]
      case "routePath":
        guard let model = AppDelegate.current?.model, let path = command["path"] as? String,
          let route = DesktopRoute(path: path)
        else { return ["error": "path?"] }
        model.navigate(route)
        return ["route": "\(model.route)"]
      case "palette":
        // What ⇧⌘P does; menu shortcuts only fire while the app is active.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        model.palette.isPresented = command["open"] as? Bool ?? !model.palette.isPresented
        let query = command["query"] as? String ?? ""
        return [
          "open": model.palette.isPresented,
          "results": model.palette.matching(query, for: model).prefix(12).map { "\($0.section): \($0.title)" },
        ]
      case "userActivity":
        // What Handoff is advertising, wherever SwiftUI attached it.
        var found: [[String: Any]] = []
        func scan(_ responder: NSResponder?) {
          guard let responder else { return }
          if let activity = responder.userActivity {
            found.append(["type": activity.activityType, "info": activity.userInfo?.mapValues { "\($0)" } ?? [:]])
          }
          if let view = responder as? NSView { view.subviews.forEach(scan) }
        }
        scan(window)
        scan(window.contentViewController)
        scan(window.contentView)
        return ["activities": found]
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
      case "selectAll":
        // Our window is rarely key, so not through the responder chain.
        guard let text = window.firstResponder as? NSText else { return ["error": "no text focused"] }
        text.selectAll(nil)
        return ["ok": true]
      case "scrollAt":
        // A pixel-precise wheel event at top-left window coordinates.
        guard let x = command["x"] as? Double, let y = command["y"] as? Double,
          let cg = CGEvent(
            scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
            wheel1: Int32(command["dy"] as? Int ?? 0), wheel2: Int32(command["dx"] as? Int ?? 0),
            wheel3: 0)
        else { return ["error": "x, y?"] }
        // An event built from a CGEvent has no window, so AppKit reads its
        // screen location as the window location: place it there.
        let screenHeight = NSScreen.screens.first?.frame.height ?? 0
        cg.location = CGPoint(x: x, y: screenHeight - (window.frame.height - y))
        guard let event = NSEvent(cgEvent: cg) else { return ["error": "event"] }
        window.sendEvent(event)
        return ["ok": true]
      case "snapshot":
        // The window's views drawn in-process, written as PNG. Video layers
        // draw nothing this way; the simulator's own screenshot shows those.
        guard let path = command["path"] as? String, let view = window.contentView?.superview,
          let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
        else { return ["error": "path? / no view"] }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { return ["error": "png"] }
        try? png.write(to: URL(fileURLWithPath: path))
        return ["ok": true, "size": "\(rep.pixelsWide)x\(rep.pixelsHigh)"]
      case "runtime":
        guard let runtime = AppDelegate.current?.model.runtime else { return [:] }
        return [
          "platform": runtime.platform.rawValue, "mode": runtime.mode.rawValue,
          "simulators": runtime.simulators.map { "\($0.name) \($0.udid) booted=\($0.booted)" },
          "android": runtime.androidDevices.map { "\($0.name) \($0.serial) online=\($0.online)" },
          "iosToolsError": runtime.iosToolsError ?? "", "androidToolsError": runtime.androidToolsError ?? "",
        ]
      case "pickRuntime":
        // What the target menu does, by id; `device` omitted for the browser.
        guard let runtime = AppDelegate.current?.model, let raw = command["platform"] as? String,
          let platform = RuntimeModel.Platform(rawValue: raw)
        else { return ["error": "platform?"] }
        runtime.runtime.select(
          platform: platform, device: command["device"] as? String, session: runtime.route.sessionId)
        if let mode = (command["mode"] as? String).flatMap(RuntimeModel.Mode.init) {
          runtime.runtime.mode = mode
        }
        return ["ok": true]
      case "makeKey":
        // Key within this app only: SwiftUI gestures skip a non-key window's
        // first click, as they would for a real one. The app stays inactive.
        window.makeKey()
        return ["ok": window.isKeyWindow]
      case "resize":
        guard let width = command["width"] as? Double, let height = command["height"] as? Double
        else { return ["error": "width, height?"] }
        window.setFrame(NSRect(x: window.frame.minX, y: window.frame.maxY - height, width: width, height: height), display: true)
        return ["ok": true]
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
    private func click(
      at point: NSPoint, in window: NSWindow, count: Int = 1, flags: NSEvent.ModifierFlags = []
    ) -> Bool {
      func event(_ type: NSEvent.EventType) -> NSEvent? {
        NSEvent.mouseEvent(
          with: type, location: point, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
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

    private func key(_ key: String, mods: [String], code keyCode: Int? = nil, in window: NSWindow) -> Bool {
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
      let (characters, code) = named[key] ?? (key, UInt16(keyCode ?? 0))
      for type in [NSEvent.EventType.keyDown, .keyUp] {
        guard
          let event = NSEvent.keyEvent(
            with: type, location: .zero, modifierFlags: flags,
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, characters: characters, charactersIgnoringModifiers: characters,
            isARepeat: false, keyCode: code)
        else { return false }
        // Key equivalents (⌘F, ⌘G) go to the view tree, then the menu, the
        // way AppKit routes them.
        if type == .keyDown, !flags.isEmpty,
          window.performKeyEquivalent(with: event) || NSApp.mainMenu?.performKeyEquivalent(with: event) == true
        {
          return true
        }
        window.sendEvent(event)
      }
      return true
    }

    private func terminalViews(in view: NSView?) -> [ArgusTerminalView] {
      guard let view else { return [] }
      return (view as? ArgusTerminalView).map { [$0] } ?? view.subviews.flatMap { terminalViews(in: $0) }
    }

    /// Each terminal's visible screen, so a driven build can check what a shell shows.
    private func terminalText(in view: NSView?) -> [String] {
      terminalViews(in: view).map { "[\($0.terminalId.prefix(8))] " + terminalScreen($0) }
    }

    private func terminalScreen(_ terminal: ArgusTerminalView) -> String {
      let t = terminal.getTerminal()
      let rows = (0..<t.rows).compactMap { t.getLine(row: $0)?.translateToString(trimRight: true) }
      return rows.filter { !$0.isEmpty }.joined(separator: "\n")
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
