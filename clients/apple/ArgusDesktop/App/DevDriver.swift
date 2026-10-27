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
  /// title, optional `index`), `key` (`key`, `mods`, `viaQueue`), `type` (`text`), `menu`
  /// (`title`), `mainMenu` (`title`: a menu bar menu's items and shortcuts),
  /// `mouseButton` (`button`: 3 back, 4 forward).
  @MainActor
  final class DevDriver {
    private let dir: URL
    private var timer: Timer?
    /// The menu being tracked right now, if a click opened one.
    private var trackedMenu: NSMenu?
    private var menuObservers: [NSObjectProtocol] = []
    private static var lastPick = ""
    /// The last `secrets` answer, read back with `secretsResult`.
    private static var secrets: [String: Any] = ["pending": true]

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
        return ["windows": NSApp.windows.map { "\($0.windowNumber) \($0.title) visible=\($0.isVisible) level=\($0.level.rawValue) id=\($0.identifier?.rawValue ?? "-") \($0.frame)" }]
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
        case "agents": model.openAgents(session: id)
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
        case "back": model.goBack(via: .button)
        case "forward": model.goForward(via: .button)
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
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        model.togglePanelTab(.terminal, via: .shortcut)
        return ["panel": model.sidePanelVisible]
      case "toggleDevicePanel":
        // What ⌥⌘B does, for the session on screen.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        model.togglePanelTab(.device, via: .shortcut)
        return ["panel": model.sidePanelVisible]
      case "toggleSidePanel":
        // What ⌘J does.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        model.toggleSidePanel(via: .shortcut)
        return ["panel": model.sidePanelVisible]
      case "terminals":
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        let tabs = model.terminals.tabsBySession.values.joined().map {
          "\($0.sessionId.prefix(8)) \($0.title) run=\($0.runTitle ?? "-") exit=\($0.exitCode.map(String.init) ?? "-")"
        }
        return [
          "tabs": tabs, "panel": model.sidePanelVisible,
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
        return ["ok": click(at: point, in: window, count: count, flags: flags, viaApp: command["viaApp"] as? Bool ?? false)]
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
      case "mouseButton":
        // A mouse's side button (3 back, 4 forward) released over the window,
        // through this app's own event queue so local monitors see it.
        guard let button = command["button"] as? Int,
          let base = NSEvent.mouseEvent(
            with: .otherMouseUp, location: NSPoint(x: 400, y: 400), modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
            eventNumber: 0, clickCount: 1, pressure: 0),
          let cg = base.cgEvent
        else { return ["error": "button?"] }
        cg.setIntegerValueField(.mouseEventButtonNumber, value: Int64(button))
        guard let event = NSEvent(cgEvent: cg) else { return ["error": "event"] }
        NSApp.postEvent(event, atStart: false)
        return ["ok": true, "button": event.buttonNumber, "window": event.windowNumber == window.windowNumber]
      case "key":
        return [
          "ok": key(
            command["key"] as? String ?? "", mods: command["mods"] as? [String] ?? [], code: command["code"] as? Int,
            viaQueue: command["viaQueue"] as? Bool ?? false, in: window)
        ]
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
      case "mainMenu":
        // A menu bar menu's items with their key equivalents and enabled state.
        guard let title = command["title"] as? String,
          let menu = NSApp.mainMenu?.items.first(where: { $0.title == title })?.submenu
        else { return ["error": "no such menu", "menus": NSApp.mainMenu?.items.map(\.title) ?? []] }
        menu.delegate?.menuNeedsUpdate?(menu)
        menu.update()
        return [
          "items": menu.items.filter { !$0.isSeparatorItem }.map { item in
            let mods = item.keyEquivalentModifierMask
            let keys = (mods.contains(.control) ? "⌃" : "") + (mods.contains(.option) ? "⌥" : "")
              + (mods.contains(.shift) ? "⇧" : "") + (mods.contains(.command) ? "⌘" : "")
            let shortcut = item.keyEquivalent.isEmpty ? "" : " " + keys + item.keyEquivalent.uppercased()
            return item.title + shortcut + (item.isEnabled ? "" : " (disabled)")
          }
        ]
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
      case "huddleAddRepo":
        // A scratch repo into the dev host, for exercising huddles on its agent.
        guard let model = AppDelegate.current?.model, let path = command["path"] as? String else {
          return ["error": "path?"]
        }
        Task {
          await model.huddles.addRepoForTesting(path)
          await model.reload()
        }
        return ["ok": true]
      case "huddleFixture":
        // A live room for `agent` without a tunnel; actions on it reach the host and fail.
        guard let model = AppDelegate.current?.model, let agent = command["agent"] as? String else {
          return ["error": "agent?"]
        }
        model.huddles.injectFixture(agentId: agent, url: command["url"] as? String)
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
      case "prefs":
        // What HostPreferences took from the host.
        let prefs = AppPreferences.shared
        return [
          "theme": prefs.theme.rawValue, "displaySize": prefs.displaySize.rawValue,
          "permissionMode": prefs.defaultPermissionMode.rawValue, "model": prefs.defaultModel,
          "editors": prefs.customEditors.map(\.name), "telemetry": MacTelemetry.mode,
          "huddleName": HuddleDisplayName.value,
          "platform": AppDelegate.current?.model.runtime.platform.rawValue ?? "",
          "hidden": Array(HomeRecents.shared.hidden), "recents": HomeRecents.shared.opened.map(\.path),
        ]
      case "secrets":
        // Asks the host for what only decrypting the stores can tell.
        guard let backend = AppDelegate.current?.model.localBackend else { return ["error": "no host"] }
        let url = command["mcpUrl"] as? String ?? ""
        Self.secrets = ["pending": true]
        Task {
          var out: [String: Any] = [:]
          do {
            let devices = try await backend.request(ArgusProtocol.Commands.RemoteListDevices.self, EmptyParams())
            out["devices"] = devices.map(\.label)
          } catch { out["devicesError"] = "\(error)" }
          let auth = try? await backend.request(ArgusProtocol.Commands.McpOauthStatus.self, .init(serverUrl: url))
          out["mcpSignedIn"] = (auth ?? nil) != nil
          let legacy = try? await backend.request(ArgusProtocol.Commands.LegacySecretStores.self, EmptyParams())
          out["legacy"] = (legacy ?? []).map(\.rawValue)
          Self.secrets = out
        }
        return ["ok": true]
      case "secretsResult":
        return Self.secrets
      case "hosts":
        // Paired hosts, what's attached and how each link is doing.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        let hosts = model.hosts
        return [
          "hosts": hosts.hosts.map {
            ["id": $0.deviceId, "label": $0.label, "url": $0.url, "caps": $0.capabilities,
             "attached": hosts.attached.contains($0.deviceId), "state": hosts.state($0.deviceId).title]
          },
          "pairing": "\(hosts.pairing)", "focused": hosts.focused,
          "filter": model.machineFilter ?? "",
          "runtimeHost": model.runtime.hostId,
          "sessionHosts": model.store.sessionsByRepo.values.joined().map { "\($0.id) @\(model.host(ofSession: $0.id))" },
          "devices": (model.runtime.simulators.map(\.udid)).map { "\($0) @\(model.backend?.host(of: .device, $0) ?? "?")" },
          "projects": model.store.projects.map { "\($0.repoRoot) @\(model.host(ofProject: $0.repoRoot))" },
        ]
      case "hostAction":
        // What the Hosts settings tab and the machines menu do.
        guard let model = AppDelegate.current?.model, let action = command["action"] as? String else {
          return ["error": "action?"]
        }
        let id = command["id"] as? String ?? ""
        switch action {
        case "pair": model.hosts.startPairing(code: command["code"] as? String ?? "")
        case "cancelPairing": model.hosts.cancelPairing()
        case "attach": model.hosts.attach(id)
        case "detach": Task { await model.hosts.detach(id) }
        case "forget": Task { await model.hosts.forget(id) }
        case "rename": model.hosts.rename(id, to: command["label"] as? String ?? "")
        case "show": model.showMachine(id.isEmpty ? nil : id)
        default: return ["error": "unknown action"]
        }
        return ["ok": true]
      case "routePath":
        guard let model = AppDelegate.current?.model, let path = command["path"] as? String,
          let route = DesktopRoute(path: path)
        else { return ["error": "path?"] }
        model.navigate(route)
        return ["route": "\(model.route)"]
      case "openLocation":
        // What a deep link does, without bringing the app forward.
        guard let model = AppDelegate.current?.model, let path = command["path"] as? String,
          let location = DesktopLocation(path: path)
        else { return ["error": "path?"] }
        model.open(location)
        return ["route": "\(model.route)", "pending": model.pendingLocation.map { $0.path } ?? ""]
      case "pickFolder":
        // What Add Project's Browse does on the focused machine, from a start folder.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        Task {
          let path = await model.pickFolder(start: command["start"] as? String)
          Self.lastPick = path ?? "(cancelled)"
        }
        return ["ok": true]
      case "uploadDrop":
        // What dropping files on a session's chat does, without a chat open.
        guard let model = AppDelegate.current?.model, let paths = command["paths"] as? [String],
          let session = command["session"] as? String
        else { return ["error": "paths, session?"] }
        Task {
          let dropped = await model.store.hostPaths(
            forDropped: paths.map { URL(fileURLWithPath: $0) }, sessionId: session)
          Self.lastPick = (dropped.paths + dropped.errors).joined(separator: "\n")
        }
        return ["ok": true]
      case "lastPick":
        return ["path": Self.lastPick]
      case "tabs":
        // The window tabs, and what the strip and menus do to them.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        switch command["action"] as? String {
        case "openHost": model.openHostTab(command["host"] as? String ?? Hosts.local)
        case "open": model.openTab()
        case "switch": model.switchTab(command["id"] as? String ?? "")
        case "close": model.closeTab(command["id"] as? String)
        case "next": model.cycleTab(by: 1)
        default: break
        }
        return [
          "active": model.activeTabId, "focused": model.hosts.focused, "route": "\(model.route)",
          "tabs": model.tabs.map { "\($0.id) \(model.title(of: $0)) \($0.location.path)" },
        ]
      case "history":
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        return [
          "location": model.location.path, "back": model.history.back.map(\.path), "forward": model.history.forward.map(\.path),
          "pending": model.pendingLocation?.path ?? "",
          "log": model.notificationsLog.entries.map(\.message),
        ]
      case "palette":
        // What ⇧⌘P does; menu shortcuts only fire while the app is active.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        if command["open"] as? Bool ?? !model.palette.isPresented {
          model.palette.present(switcher: command["switcher"] as? Bool ?? false)
        } else {
          model.palette.isPresented = false
        }
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
      case "changeMenu":
        // A Changes row's Create Patch / LFS items: list them, or run one by title.
        guard let model = AppDelegate.current?.model, let id = command["session"] as? String,
          let workspace = model.git.workspace(id), let path = command["path"] as? String
        else { return ["error": "session, path?"] }
        let section = ChangeSection(rawValue: command["section"] as? String ?? "Unstaged") ?? .unstaged
        let vm = workspace.workingCopy
        let pool = section == .staged ? vm.stagedFiles : vm.unstagedFiles
        guard let entry = pool.first(where: { $0.path == path }) else { return ["error": "no \(section) \(path)"] }
        let items = ChangeLFSAndPatchMenu.items(
          workspace: workspace, entry: entry, section: section,
          entries: vm.actionEntries(for: entry, side: section.side))
        if let title = command["pick"] as? String {
          guard let item = items.first(where: { $0.title == title }) else { return ["error": "no item \(title)"] }
          item.run()
        }
        return ["items": items.map(\.title)]
      case "gitGeneration":
        // How many times a session's git views refreshed, to see what its watcher reacts to.
        guard let id = command["session"] as? String, let workspace = AppDelegate.current?.model.git.workspace(id)
        else { return ["error": "session?"] }
        return ["generation": workspace.generation, "active": workspace.isActive]
      case "host":
        // Whose host this window is on, and what it told that host it is.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        return [
          "state": "\(model.supervisor.state)", "attachOnly": model.supervisor.configuration.attachOnly,
          "home": model.supervisor.configuration.home.path, "role": model.platform.role.rawValue,
          "agents": model.store.statusByAgent.mapValues { $0.status.rawValue },
          "prompts": model.store.prompts.values.map { "\($0.agentId) \($0.toolUseId) \($0.toolName)" },
          "messages": model.store.messagesByAgent.mapValues { $0.map { "\($0.role.rawValue): \($0.textBlocks.joined())" } },
        ]
      case "takeOver", "startHere":
        // Past the confirmation: what its Take Over / Start Argus Here buttons do.
        guard let supervisor = AppDelegate.current?.model.supervisor else { return ["error": "no model"] }
        if command["op"] as? String == "takeOver" { supervisor.takeOver() } else { supervisor.start() }
        return ["ok": true]
      case "send":
        // What the chat input does on Return.
        guard let store = AppDelegate.current?.model.store, let agent = command["agent"] as? String
        else { return ["error": "agent?"] }
        Task { await store.sendMessage(agentId: agent, message: command["text"] as? String ?? "") }
        return ["ok": true]
      case "respond":
        // What the permission form's buttons do.
        guard let store = AppDelegate.current?.model.store, let agent = command["agent"] as? String,
          let toolUseId = command["toolUseId"] as? String
        else { return ["error": "agent? toolUseId?"] }
        Task { await store.respond(agentId: agent, toolUseId: toolUseId, decision: command["decision"] as? String ?? "allow") }
        return ["ok": true]
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
      case "firstResponder":
        let responder = window.firstResponder
        return ["class": responder.map { String(describing: type(of: $0)) } ?? "", "route": "\(AppDelegate.current?.model.route as Any)"]
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
      case "hitTest":
        // Which views sit under a point (top-left window coordinates), and
        // whether each takes a background window's first click.
        guard let x = command["x"] as? Double, let y = command["y"] as? Double,
          let root = window.contentView?.superview
        else { return ["error": "x, y?"] }
        var view = root.hitTest(NSPoint(x: x, y: window.frame.height - y))
        var chain: [String] = []
        while let current = view, chain.count < 14 {
          chain.append("\(type(of: current)) firstMouse=\(current.acceptsFirstMouse(for: nil))")
          view = current.superview
        }
        return ["chain": chain, "key": window.isKeyWindow]
      case "diffSelect":
        // Selects diff rows by index, as a click would; a driven window is
        // never key, so the table's own mouse tracking doesn't run.
        guard let root = window.contentView?.superview else { return ["error": "no view"] }
        func findTable(_ view: NSView) -> DiffNSTableView? {
          (view as? DiffNSTableView) ?? view.subviews.lazy.compactMap(findTable).first
        }
        guard let table = findTable(root) else { return ["error": "no diff table"] }
        let rows = IndexSet(command["rows"] as? [Int] ?? [])
        table.selectRowIndexes(rows, byExtendingSelection: false)
        return ["rows": table.numberOfRows, "selected": Array(table.selectedRowIndexes)]
      case "splits":
        // Every split view's panes, to see which one won't shrink.
        var found: [String] = []
        func scan(_ view: NSView, depth: Int) {
          if let split = view as? NSSplitView {
            let panes = split.arrangedSubviews.map { "\(Int($0.frame.width))(fit \(Int($0.fittingSize.width)))" }
            found.append("\(depth) \(type(of: split)) w=\(Int(split.frame.width)) [\(panes.joined(separator: ", "))]")
          }
          view.subviews.forEach { scan($0, depth: depth + 1) }
        }
        if let root = window.contentView?.superview { scan(root, depth: 0) }
        return ["splits": found]
      case "activation":
        // Whether this app is frontmost; `deactivate` hands focus back first,
        // `activate` brings this app forward for checks that need a key window.
        if command["deactivate"] as? Bool == true { NSApp.deactivate() }
        if command["activate"] as? Bool == true { NSApp.activate() }
        return ["active": NSApp.isActive, "key": window.isKeyWindow]
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
        return StallDriver.run(command) ?? TranscriptDriver.run(command, window: window) ?? ["error": "unknown op"]
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
      at point: NSPoint, in window: NSWindow, count: Int = 1, flags: NSEvent.ModifierFlags = [],
      viaApp: Bool = false
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
      // Through the event queue, as a real click arrives: local event
      // monitors and AppKit's first-mouse check both see it.
      if viaApp {
        NSApp.postEvent(down, atStart: false)
        NSApp.postEvent(up, atStart: false)
        return true
      }
      NSApp.postEvent(up, atStart: false)
      window.sendEvent(down)
      return true
    }

    /// `viaQueue` posts the press to this app's own event queue, so local monitors see it as they do a real one.
    private func key(_ key: String, mods: [String], code keyCode: Int? = nil, viaQueue: Bool = false, in window: NSWindow) -> Bool {
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
        if viaQueue {
          NSApp.postEvent(event, atStart: false)
          continue
        }
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
