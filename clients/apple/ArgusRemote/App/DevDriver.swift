#if DEBUG
  import ArgusKit
  import SwiftUI
  import UIKit

  /// Drives a dev build in the simulator from JSON files, so it can be
  /// exercised against a test host without UI scripting.
  ///
  /// `ARGUS_DEV_DRIVER=<dir>` (pass it as `SIMCTL_CHILD_ARGUS_DEV_DRIVER`): each
  /// `cmd-<n>.json` is run once and answered in `out-<n>.json`. Ops: `pair`
  /// (`code`), `route` (`section`, `path`), `back`, `tree`, `press` (accessibility
  /// label, optional `index`), `type` (`text`, into the first text field or view).
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
          router.select(section)
          router.popToRoot()
          return ["ok": true]
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
        ]
      case "tree":
        return [
          "ok": true,
          "labels": elements().map {
            command["types"] as? Bool == true ? "\($0.label) <\(type(of: $0.element))>" : $0.label
          },
        ]
      case "press":
        let label = command["label"] as? String ?? ""
        let matches = elements().filter { $0.label == label }
        let index = command["index"] as? Int ?? 0
        guard matches.indices.contains(index) else {
          return ["ok": false, "error": "no \(label)", "count": matches.count]
        }
        let element = matches[index].element
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
          control.sendActions(for: .primaryActionTriggered)
          control.sendActions(for: .touchUpInside)
          return ["ok": true, "via": "control"]
        }
        return ["ok": false, "type": String(describing: type(of: element))]
      case "type":
        let text = command["text"] as? String ?? ""
        guard let field = firstTextInput() else { return ["ok": false, "error": "no field"] }
        field.becomeFirstResponder()
        (field as? UIKeyInput)?.insertText(text)
        return ["ok": true]
      default:
        return ["ok": false, "error": "unknown op"]
      }
    }

    private func pair(_ payload: PairingPayload, app: AppStore) {
      let client = PairingClient(
        payload: payload,
        client: PairingClientInfo(product: "Argus Remote", kind: "mobile", device: "m65 dev"))
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

    private func firstTextInput() -> UIView? {
      guard let window else { return nil }
      var stack: [UIView] = [window]
      while let view = stack.popLast() {
        if view is UITextField || view is UITextView, !view.isHidden { return view }
        stack.append(contentsOf: view.subviews.reversed())
      }
      return nil
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
      case "terminals": self = .terminals(sessionId: arg(1), label: arg(2))
      case "terminal": self = .terminal(id: arg(1), label: arg(2))
      case "inbox": self = .inbox
      case "automations": self = .automations
      case "automation": self = .automation(id: arg(1), label: arg(2))
      case "run": self = .run(id: arg(1), label: arg(2))
      case "settings": self = .settings
      case "devices": self = .devices
      case "pullRequests": self = .pullRequests
      default: return nil
      }
    }
  }
#endif
