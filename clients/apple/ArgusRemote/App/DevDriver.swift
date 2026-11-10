#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI
  import UIKit

  /// Drives a dev build in the simulator from JSON files, so it can be
  /// exercised against a test host without UI scripting.
  ///
  /// `ARGUS_DEV_DRIVER=<dir>` (pass it as `SIMCTL_CHILD_ARGUS_DEV_DRIVER`): each
  /// `cmd-<n>.json` is run once and answered in `out-<n>.json`. Ops: `pair`
  /// (`code`), `route` (`path`: an `argus://` path like `/sessions/<id>/agents`,
  /// or the older `name:arg` with a `section`), `back`, `tree`, `press` (accessibility
  /// label, optional `index`), `type` (`text`, into the first text field or view; `clear` empties it first),
  /// `dismiss` (the keyboard), `sidebar` (select a session row: `id`, `label`, `repoRoot`, `projectName`),
  /// `traits` (`sizeClass`, `orientation`),
  /// `actions` (an element's long-press and swipe actions by `label` or `contains`; `name` performs one),
  /// `links` (a text's links; `link` taps one by index), `scroll` (`to`: `top`/`bottom`, reports the offset),
  /// `pasteImage` (a test image into the composer, as a paste).
  @MainActor
  final class DevDriver {
    private let dir: URL
    private weak var app: AppStore?
    private weak var router: Router?
    private var timer: Timer?
    private var pairing: Task<Void, Never>?

    static func startIfConfigured(app: AppStore, router: Router) -> DevDriver? {
      guard let path = ProcessInfo.processInfo.environment["ARGUS_DEV_DRIVER"] else { return nil }
      // The system's push prompt would sit over every screen the driver opens.
      app.preferences.set("off", for: PreferenceKey.pushEnabled)
      let driver = DevDriver(dir: URL(fileURLWithPath: path), app: app, router: router)
      driver.start()
      return driver
    }

    private init(dir: URL, app: AppStore, router: Router) {
      self.dir = dir
      self.app = app
      self.router = router
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /// SwiftUI only builds its accessibility tree for an assistive client;
    /// claim to be one, as XCUITest does.
    private func enableAccessibility() {
      guard let lib = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW) else { return }
      typealias SetEnabled = @convention(c) (Int32) -> Void
      for name in ["_AXSSetAutomationEnabled", "_AXSApplicationAccessibilitySetEnabled"] {
        if let symbol = dlsym(lib, name) {
          unsafeBitCast(symbol, to: SetEnabled.self)(1)
        }
      }
    }

    private func start() {
      enableAccessibility()
      let timer = Timer(timeInterval: 0.3, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.poll() }
      }
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
    }

    private func poll() {
      let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
      for name in files.sorted() where name.hasPrefix("cmd-") && name.hasSuffix(".json") {
        let url = dir.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url),
          var command = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { continue }
        try? FileManager.default.removeItem(at: url)
        let out = dir.appendingPathComponent(name.replacingOccurrences(of: "cmd-", with: "out-"))
        command["_out"] = out
        let result = run(command)
        if result["pending"] == nil, let json = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted]) {
          try? json.write(to: out)
        }
      }
    }

    private func run(_ command: [String: Any]) -> [String: Any] {
      guard let app, let router else { return ["ok": false, "error": "gone"] }
      switch command["op"] as? String {
      case "pair":
        guard let code = command["code"] as? String,
          let payload = try? PairingClient.parse(code)
        else { return ["ok": false, "error": "bad code"] }
        pair(payload, app: app)
        return ["ok": true]
      case "route":
        let section = AppSection(rawValue: command["section"] as? String ?? "") ?? router.section
        guard let path = command["path"] as? String else {
          router.show(section)
          router.popToRoot()
          return ["ok": true]
        }
        if path.hasPrefix("/") {
          guard let location = ArgusLocation(path: path) else { return ["ok": false, "error": "bad path"] }
          let out = command["_out"] as? URL
          Task {
            if let host = location.host, host != app.activeHostId { await app.selectHost(host) }
            let destination = await PhoneDestination.resolve(location.route, host: app.host)
            router.open(destination)
            let result: [String: Any] = [
              "ok": true, "section": destination.section.rawValue,
              "screen": destination.route?.pattern ?? "", "fallback": destination.isFallback,
            ]
            if let out, let json = try? JSONSerialization.data(withJSONObject: result) { try? json.write(to: out) }
          }
          return ["pending": true]
        }
        guard let route = Route(devPath: path) else { return ["ok": false, "error": "bad path"] }
        router.open(route, in: section)
        return ["ok": true]
      case "back":
        if router.isSplit {
          _ = router.detailStack.popLast()
        } else {
          _ = router.paths[router.section]?.popLast()
        }
        return ["ok": true]
      case "request":
        // Answered asynchronously: the out file lands when the host replies.
        guard let method = RemoteMethod(rawValue: command["method"] as? String ?? ""),
          let backend = app.host.backend
        else { return ["ok": false, "error": "bad method or offline"] }
        let params = (try? JSONSerialization.data(withJSONObject: command["params"] ?? [:]))
          .flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } ?? .object([:])
        let out = command["_out"] as? URL
        Task {
          let result: [String: Any]
          do {
            let value = try await backend.request(method, params, as: JSONValue.self)
            let data = try JSONEncoder().encode(value)
            result = ["ok": true, "result": try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)]
          } catch {
            result = ["ok": false, "error": "\(error)"]
          }
          if let out, let json = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted]) {
            try? json.write(to: out)
          }
        }
        return ["pending": true]
      case "state":
        return [
          "ok": true, "connection": "\(app.host.connection)",
          "hosts": app.hosts.count, "error": app.host.lastError ?? "",
          "section": router.section.rawValue,
          "sidebar": router.sidebarSelection.map { "\($0)" } ?? "",
          "project": router.detailProject?.name ?? "",
          "stack": (router.isSplit ? router.detailStack : router.path(for: router.section)).map(\.pattern),
          "panel": router.panelOpen ? router.panelTab.rawValue : "",
          "panelStack": router.panelPaths.values.flatMap { $0.map(\.pattern) },
          "focusedAgents": router.focusedAgents.byKey,
        ]
      case "tree":
        return [
          "ok": true,
          "labels": elements().map {
            command["types"] as? Bool == true ? "\($0.label) <\(type(of: $0.element))>"
              : command["frames"] as? Bool == true ? "\($0.label) @\(NSCoder.string(for: $0.element.accessibilityFrame))"
              : $0.label
          },
        ]
      case "press":
        let label = command["label"] as? String ?? ""
        let matches = elements().filter { $0.label == label }
        let index = command["index"] as? Int ?? 0
        guard matches.indices.contains(index) else {
          return ["ok": false, "error": "no \(label)", "count": matches.count]
        }
        if pressAlertAction(label) { return ["ok": true, "via": "alert"] }
        let element = matches[index].element
        if pressSegment(element, label: label) { return ["ok": true, "via": "segment"] }
        if element.accessibilityActivate() { return ["ok": true] }
        if let item = barButtonItem(label: label) {
          if let action = item.primaryAction {
            action.perform(NSSelectorFromString("performWithSender:target:"), with: item, with: nil)
          } else if let selector = item.action {
            UIApplication.shared.sendAction(selector, to: item.target, from: item, for: nil)
          }
          return ["ok": true, "via": "barButtonItem"]
        }
        // UIKit bar buttons don't answer activate; fire their control instead.
        var view: UIView? = element as? UIView
        while let current = view, !(current is UIControl) { view = current.superview }
        if let control = view as? UIControl {
          // Send only one event: controls listening to both would otherwise fire twice.
          let event: UIControl.Event =
            control.allControlEvents.contains(.primaryActionTriggered) ? .primaryActionTriggered : .touchUpInside
          control.sendActions(for: event)
          return ["ok": true, "via": "control"]
        }
        return ["ok": false, "type": String(describing: type(of: element))]
      case "type":
        let text = command["text"] as? String ?? ""
        let inputs = textInputs()
        let index = command["index"] as? Int ?? 0
        guard inputs.indices.contains(index) else { return ["ok": false, "error": "no field"] }
        let field = inputs[index]
        field.becomeFirstResponder()
        if command["clear"] as? Bool == true, let input = field as? UIKeyInput {
          while input.hasText { input.deleteBackward() }
        }
        (field as? UIKeyInput)?.insertText(text)
        return ["ok": true]
      case "sidebar":
        // What tapping an iPad sidebar session row does.
        router.apply(
          .session(
            id: command["id"] as? String ?? "", label: command["label"] as? String ?? "",
            repoRoot: command["repoRoot"] as? String ?? "", projectName: command["projectName"] as? String ?? ""))
        return ["ok": true]
      case "dismiss":
        window?.endEditing(true)
        return ["ok": true]
      case "traits":
        // What a Split View resize (`sizeClass`: compact, regular, none) or a rotation (`orientation`) does.
        guard let window, let scene = window.windowScene else { return ["ok": false, "error": "no scene"] }
        switch command["sizeClass"] as? String {
        case "compact": window.traitOverrides.horizontalSizeClass = .compact
        case "regular": window.traitOverrides.horizontalSizeClass = .regular
        case "none": window.traitOverrides.remove(UITraitHorizontalSizeClass.self)
        default: break
        }
        if let orientation = command["orientation"] as? String {
          let mask: UIInterfaceOrientationMask = orientation == "landscape" ? .landscapeRight : .portrait
          scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
        }
        return ["ok": true]
      case "actions":
        return customActions(command)
      case "links":
        return links(command)
      case "scroll":
        return scroll(command)
      case "pasteImage":
        return pasteImage()
      default:
        return ["ok": false, "error": "unknown op"]
      }
    }

    private func pair(_ payload: PairingPayload, app: AppStore) {
      let client = PairingClient(
        payload: payload,
        client: PairingClientInfo(product: "Argus", kind: "mobile", device: "m65 dev"))
      pairing = Task {
        for await event in await client.start() {
          if case .paired(let identity) = event {
            await app.pairCompleted(identity)
          }
        }
      }
    }

    private var window: UIWindow? {
      UIApplication.shared.connectedScenes
        .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
    }

    private struct Found {
      let label: String
      let element: NSObject
    }

    /// Every labelled accessibility element on screen, in reading order.
    private func elements() -> [Found] {
      guard let window else { return [] }
      var found: [Found] = []
      walk(window, into: &found, depth: 0)
      return found
    }

    private func walk(_ object: NSObject, into found: inout [Found], depth: Int) {
      guard depth < 80 else { return }
      if object.isAccessibilityElement, let label = object.accessibilityLabel, !label.isEmpty {
        found.append(Found(label: label, element: object))
      }
      if let view = object as? UIView, view.isHidden { return }
      let count = object.accessibilityElementCount()
      if count != NSNotFound, count > 0 {
        for index in 0..<count {
          if let child = object.accessibilityElement(at: index) as? NSObject {
            walk(child, into: &found, depth: depth + 1)
          }
        }
      } else if let children = object.accessibilityElements as? [NSObject], !children.isEmpty {
        for child in children { walk(child, into: &found, depth: depth + 1) }
      } else if let view = object as? UIView {
        for sub in view.subviews { walk(sub, into: &found, depth: depth + 1) }
      }
    }

    /// The element a command names: `label` exactly, or the first label holding `contains`; `index` among those.
    private func target(_ command: [String: Any]) -> NSObject? {
      let all = elements()
      let matches =
        if let needle = command["contains"] as? String {
          all.filter { $0.label.contains(needle) }
        } else {
          all.filter { $0.label == command["label"] as? String ?? "" }
        }
      let index = command["index"] as? Int ?? 0
      return matches.indices.contains(index) ? matches[index].element : nil
    }

    /// Long-press menus and swipe actions, as VoiceOver reaches them: the custom
    /// actions on the element or a container above it. Lists them, or performs `name`.
    private func customActions(_ command: [String: Any]) -> [String: Any] {
      guard let element = target(command) else { return ["ok": false, "error": "no element"] }
      var actions: [UIAccessibilityCustomAction] = []
      var current: NSObject? = element
      for _ in 0..<8 {
        guard let object = current else { break }
        actions += object.accessibilityCustomActions ?? []
        current = (object as? UIView)?.superview ?? container(of: object)
      }
      guard let name = command["name"] as? String else { return ["ok": true, "actions": actions.map(\.name)] }
      guard let action = actions.first(where: { $0.name == name }) else {
        return ["ok": false, "error": "no action \(name)", "actions": actions.map(\.name)]
      }
      if let handler = action.actionHandler { return ["ok": handler(action)] }
      if let target = action.target as? NSObject, target.responds(to: action.selector) {
        target.perform(action.selector, with: action)
        return ["ok": true]
      }
      return ["ok": false, "error": "action has no handler"]
    }

    /// What holds a non-view element; SwiftUI's elements answer it without being `UIAccessibilityElement`s.
    private func container(of object: NSObject) -> NSObject? {
      let selector = NSSelectorFromString("accessibilityContainer")
      guard object.responds(to: selector) else { return nil }
      return object.perform(selector)?.takeUnretainedValue() as? NSObject
    }

    /// The links in a text element, through VoiceOver's links rotor. Lists them, or activates `link` (an index).
    private func links(_ command: [String: Any]) -> [String: Any] {
      guard let element = target(command) else { return ["ok": false, "error": "no element"] }
      guard let rotor = (element.accessibilityCustomRotors ?? []).first(where: { $0.systemRotorType == .link }) else {
        return ["ok": false, "error": "no links rotor", "rotors": (element.accessibilityCustomRotors ?? []).map(\.name)]
      }
      var found: [NSObject] = []
      var item: UIAccessibilityCustomRotorItemResult?
      for _ in 0..<50 {
        let predicate = UIAccessibilityCustomRotorSearchPredicate()
        predicate.searchDirection = .next
        if let item { predicate.currentItem = item }
        guard let next = rotor.itemSearchBlock(predicate), let element = next.targetElement as? NSObject,
          !found.contains(where: { $0 === element })
        else { break }
        found.append(element)
        item = next
      }
      guard let pick = command["link"] as? Int else {
        return ["ok": true, "links": found.map { $0.accessibilityLabel ?? "" }]
      }
      guard found.indices.contains(pick) else { return ["ok": false, "error": "no link \(pick)", "count": found.count] }
      // SwiftUI's link elements don't activate; land where the tap would.
      let label = found[pick].accessibilityLabel ?? ""
      return ["ok": DevLinkTap.tap(label: label), "link": label]
    }

    /// Scrolls the screen's tallest scroll view to `to` (`top` or `bottom`) and
    /// reports where it ended up; without `to`, only reports.
    private func scroll(_ command: [String: Any]) -> [String: Any] {
      guard let window else { return ["ok": false] }
      var views: [UIScrollView] = []
      var stack: [UIView] = [window]
      while let view = stack.popLast() {
        if let scroll = view as? UIScrollView, !view.isHidden, !(view is UITextView),
          scroll.contentSize.height > scroll.contentSize.width / 4
        {
          views.append(scroll)
        }
        stack.append(contentsOf: view.subviews)
      }
      guard let view = views.max(by: { $0.bounds.height < $1.bounds.height }) else {
        return ["ok": false, "error": "no scroll view"]
      }
      let inset = view.adjustedContentInset
      switch command["to"] as? String {
      case "top": view.setContentOffset(CGPoint(x: 0, y: -inset.top), animated: true)
      case "bottom":
        let maxY = max(view.contentSize.height + inset.bottom - view.bounds.height, -inset.top)
        view.setContentOffset(CGPoint(x: 0, y: maxY), animated: true)
      default: break
      }
      return [
        "ok": true, "offset": view.contentOffset.y, "height": view.bounds.height,
        "content": view.contentSize.height, "insetTop": inset.top, "insetBottom": inset.bottom,
      ]
    }

    /// An image into the composer the way a paste lands, since the photo picker runs out of process.
    private func pasteImage() -> [String: Any] {
      guard let field = textInputs().first(where: { $0 is UITextView }) as? UITextView else {
        return ["ok": false, "error": "no composer"]
      }
      let image = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
        UIColor.systemTeal.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
      }
      UIPasteboard.general.image = image
      field.becomeFirstResponder()
      field.paste(nil)
      return ["ok": true]
    }

    /// A segment of a segmented control, picked the way a tap would: its segments
    /// don't answer activate, and the control's touch-up doesn't pick one.
    private func pressSegment(_ element: NSObject, label: String) -> Bool {
      var current: NSObject? = element
      for _ in 0..<8 {
        guard let object = current else { return false }
        if let control = object as? UISegmentedControl {
          guard let index = (0..<control.numberOfSegments).first(where: { control.titleForSegment(at: $0) == label })
          else { return false }
          control.selectedSegmentIndex = index
          control.sendActions(for: .valueChanged)
          return true
        }
        current = (object as? UIView)?.superview ?? container(of: object)
      }
      return false
    }

    /// An alert's action, run the way a tap would: dismiss, then its handler.
    private func pressAlertAction(_ label: String) -> Bool {
      var top = window?.rootViewController
      while let presented = top?.presentedViewController { top = presented }
      guard let alert = top as? UIAlertController,
        let action = alert.actions.first(where: { $0.title == label })
      else { return false }
      typealias Handler = @convention(block) (UIAlertAction) -> Void
      let handler = (action.value(forKey: "handler") as AnyObject?).map {
        unsafeBitCast($0, to: Handler.self)
      }
      alert.dismiss(animated: false) { handler?(action) }
      return true
    }

    private func barButtonItem(label: String) -> UIBarButtonItem? {
      var controllers: [UIViewController] = window?.rootViewController.map { [$0] } ?? []
      while let controller = controllers.popLast() {
        let items = (controller.navigationItem.rightBarButtonItems ?? [])
          + (controller.navigationItem.leftBarButtonItems ?? [])
          + (controller.toolbarItems ?? [])
        if let item = items.first(where: { $0.accessibilityLabel == label || $0.title == label }) {
          return item
        }
        controllers.append(contentsOf: controller.children)
        if let presented = controller.presentedViewController { controllers.append(presented) }
      }
      return nil
    }

    /// Text fields and views on screen, in view order.
    private func textInputs() -> [UIView] {
      guard let window else { return [] }
      var found: [UIView] = []
      var stack: [UIView] = [window]
      while let view = stack.popLast() {
        if view is UITextField || view is UITextView, !view.isHidden {
          found.append(view)
          continue
        }
        stack.append(contentsOf: view.subviews.reversed())
      }
      return found
    }
  }

  extension Route {
    /// `name[:arg[:arg]]` for the driver, e.g. `agents`, `terminal:<id>`.
    init?(devPath: String) {
      let parts = devPath.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
      let arg = { (index: Int) in parts.indices.contains(index) ? parts[index] : "" }
      switch parts[0] {
      case "agents": self = .agents
      case "projects": self = .projects
      case "project": self = .project(repoRoot: arg(1), name: arg(2))
      case "agent": self = .agent(id: arg(1), label: arg(2))
      case "session": self = .session(id: arg(1), label: arg(2), repoRoot: arg(3))
      case "terminals": self = .terminals(sessionId: arg(1), label: arg(2))
      case "terminal": self = .terminal(id: arg(1), label: arg(2))
      case "changes": self = .changes(sessionId: arg(1), label: arg(2))
      case "file": self = .file(sessionId: arg(1), path: arg(2), line: Int(arg(3)), source: .chatLink)
      case "quickOpen": self = .quickOpen(sessionId: arg(1), label: arg(2))
      case "fileSearch": self = .fileSearch(sessionId: arg(1), label: arg(2))
      case "stashes": self = .stashes(sessionId: arg(1), label: arg(2))
      case "inbox": self = .inbox
      case "proposal": self = .proposal(id: arg(1))
      case "describeAutomation": self = .describeAutomation
      case "notifications": self = .notifications
      case "usage": self = .usage
      case "automations": self = .automations
      case "automation": self = .automation(id: arg(1), label: arg(2))
      case "run": self = .run(id: arg(1), label: arg(2))
      case "settings": self = .settings
      case "settingsPage":
        guard let page = SettingsPane(rawValue: arg(1)) else { return nil }
        self = .settingsPage(page)
      case "devices": self = .devices
      case "pullRequests": self = .pullRequests
      case "issues": self = .issues
      case "issue": self = .issue(ref: arg(1))
      default: return nil
      }
    }
  }
#endif
