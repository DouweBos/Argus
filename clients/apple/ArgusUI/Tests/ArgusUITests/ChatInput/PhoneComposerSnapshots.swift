#if os(iOS)
  import ArgusCore
  import ArgusKit
  import SwiftUI
  import Testing
  import UIKit

  @testable import ArgusUI

  /// The phone composers rendered in the simulator against fixtures, dark and
  /// light, to `$ARGUS_SNAPSHOT_DIR` (default: a temp dir) for review:
  /// `xcodebuild test -scheme ArgusUI -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:ArgusUITests/PhoneComposerSnapshots`
  @MainActor
  @Suite("Phone composer snapshots", .serialized)
  struct PhoneComposerSnapshots {
    /// iPhone SE (1st gen) / mini width, the common 390, and Pro Max.
    private static let widths: [CGFloat] = [320, 390, 440]

    @Test("new session start composer")
    func startComposer() async throws {
      let host = await Self.host()
      try await Self.render("start-composer", host: host) {
        AgentStartPane(repoRoot: "/Users/dev/Projects/Argus", sessionId: nil, workspace: .worktree, picksProject: true) {
          _, _ in
        }
      }
    }

    @Test("long labels: extra-high effort, accept-edits mode, a linked project")
    func longLabels() async throws {
      let host = await Self.host()
      let controller = PastingTextController()
      let composer = ComposerModel(
        agentId: "start:long", sessionId: nil, host: host,
        starter: ComposerStarter(defaultMode: "auto") { _ in false }, style: .phone, editor: controller)
      await composer.load()
      composer.setEffort("xhigh")
      composer.setPermissionMode(.review)
      composer.toggleLink("/Users/dev/Projects/conductor")
      try await Self.render("composer-long", host: host) {
        VStack(spacing: 0) {
          Spacer()
          PhoneChatInputView(composer: composer, controller: controller)
        }
      }
    }

    @Test("agent chat composer")
    func chatComposer() async throws {
      let host = await Self.host()
      try await Self.render("chat-composer", host: host) {
        VStack(spacing: 0) {
          Spacer()
          PhoneChatInputView(host: host, agentId: "a1", sessionId: nil, onAffordance: nil)
        }
      }
    }

    // MARK: Rendering

    private static func render(
      _ name: String, host: HostStore, @ViewBuilder content: () -> some View
    ) async throws {
      let dir = URL(
        fileURLWithPath: ProcessInfo.processInfo.environment["ARGUS_SNAPSHOT_DIR"]
          ?? FileManager.default.temporaryDirectory.appendingPathComponent("argus-phone-snapshots").path)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      for width in widths {
      for style in [UIUserInterfaceStyle.dark, .light] {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
        window.overrideUserInterfaceStyle = style
        window.rootViewController = UIHostingController(
          rootView: NavigationStack { content().navigationTitle("New Session").inlineNavigationTitle() }
            .environment(host)
            .environment(\.theme, style == .dark ? Theme.dark : Theme.light)
            .preferredColorScheme(style == .dark ? .dark : .light))
        window.makeKeyAndVisible()
        // Let the stores' loads land and the layout settle.
        try await Task.sleep(for: .milliseconds(800))
        window.layoutIfNeeded()
        // The test runner has no scene, so nothing is on screen to snapshot; draw the layers instead.
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { context in
          window.layer.render(in: context.cgContext)
        }
        let file = dir.appendingPathComponent("\(name)-\(Int(width))-\(style == .dark ? "dark" : "light").png")
        try #require(image.pngData()).write(to: file)
        print("snapshot: \(file.path)")
        window.isHidden = true
      }
      }
    }

    private static func host() async -> HostStore {
      let host = HostStore()
      host.capabilities = ["monitor", "control", "admin"]
      await host.attach(SnapshotBackend(fixtures))
      await host.refreshProjects()
      return host
    }

    private static let models: [[String: Any]] = [
      [
        "value": "default", "displayName": "Claude Opus 5.5", "description": "Most capable",
        "supportsEffort": true, "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],
      ],
      ["value": "sonnet", "displayName": "Claude Sonnet 5.5", "description": "Fast"],
    ]

    private static let fixtures: [String: Any] = [
      RemoteMethod.projectsList.rawValue: [
        "projects": ["Argus", "react-native-client", "conductor"].map {
          ["repo_root": "/Users/dev/Projects/\($0)", "name": $0]
        }
      ],
      RemoteMethod.agentsCapabilities.rawValue: ["capabilities": ["models": models, "commands": [], "agents": []]],
      RemoteMethod.automationsRunners.rawValue: [
        "runners": [
          [
            "id": "claude-code", "display_name": "Claude Code", "is_custom": false, "models": [],
            "reported_models": models,
          ],
          ["id": "codex", "display_name": "Codex", "is_custom": false, "models": []],
        ]
      ],
    ]
  }

  /// Answers from wire-format fixtures by method name; anything else fails.
  private final class SnapshotBackend: HostBackend, @unchecked Sendable {
    struct Unanswered: Error {}

    let kind = HostBackendKind.local
    private let replies: [String: Data]

    init(_ fixtures: [String: Any]) {
      replies = fixtures.compactMapValues { try? JSONSerialization.data(withJSONObject: $0) }
    }

    func events() async -> AsyncStream<HostEvent> { AsyncStream { _ in } }

    func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
      _ method: RemoteMethod, _ params: Params, as: Result.Type
    ) async throws -> Result {
      try answer(method.rawValue)
    }

    func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
      try answer(C.name)
    }

    func subscribe(agentId: String, on: Bool) async {}
    func disconnect() async {}

    private func answer<Result: Decodable>(_ name: String) throws -> Result {
      guard let data = replies[name] else { throw Unanswered() }
      return try ProtocolCodec.decoder.decode(Result.self, from: data)
    }
  }
#endif
