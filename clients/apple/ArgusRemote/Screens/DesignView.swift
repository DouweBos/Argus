import ArgusUI
import SwiftUI

/// A Figma frame in the shared design viewer, as the Mac's `/design`. Opened
/// for a session, it flags a design that moved on and compares against the
/// computer's running simulators.
struct DesignView: View {
  @Environment(HostStore.self) private var host
  let url: String
  let sessionId: String?

  var body: some View {
    DesignContent(
      model: DesignViewerModel(url: url, sessionVersion: session.flatMap { DesignViewerModel.sessionVersion(of: url, in: $0) }, host: host),
      forSession: session != nil)
  }

  private var session: RemoteSession? { sessionId.flatMap(host.loadedSession(id:)) }
}

private struct DesignContent: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @State private var model: DesignViewerModel
  let forSession: Bool

  init(model: DesignViewerModel, forSession: Bool) {
    model.onFirstSelection = { Telemetry.capture(.designLayerSelected(source: $0)) }
    _model = State(initialValue: model)
    self.forSession = forSession
  }

  var body: some View {
    DesignViewerView(
      model: model, compareTargets: forSession ? targets : nil,
      compareHint: "Boot a simulator or emulator on the computer to compare against it.")
      .background(theme.bg.ignoresSafeArea())
      .navigationTitle(model.details?.frame.name ?? "Design")
      .navigationBarTitleDisplayMode(.inline)
      .refreshable { await model.load() }
      .task { if forSession, host.connection == .ready { await host.refreshDevices() } }
  }

  /// The computer's own running simulators and emulators: the ones it can screenshot.
  private var targets: [DesignCompareTarget] {
    host.devices
      .filter { $0.booted && $0.deviceHostLabel == nil && !$0.isTv }
      .map { DesignCompareTarget(platform: $0.platform, deviceKey: $0.id, name: $0.name) }
  }
}

/// A session's ticket and design frames as chips, opening each in the app.
struct SessionReferenceLinks: View {
  @Environment(Router.self) private var router
  let session: RemoteSession

  var body: some View {
    let designs = session.designRefs ?? []
    if SessionReferences.any(in: session) {
      FlowRow(spacing: 6, rowSpacing: 6, packed: true) {
        if let issue = session.linkedIssue {
          Chip(label: "\(issue.identifier) \(issue.title)", icon: Icon.issue) {
            router.push(.issue(ref: issue.identifier))
          }
          .accessibilityHint("Opens the issue")
        }
        ForEach(designs, id: \.url) { design in
          Chip(label: design.name, icon: Icon.design) { SessionReferences.open(design, in: session, router: router) }
            .accessibilityHint("Opens the design")
        }
      }
    }
  }
}

/// The agent screen's toolbar menu of its session's ticket and designs.
struct SessionReferencesMenu: View {
  @Environment(Router.self) private var router
  let session: RemoteSession

  var body: some View {
    let designs = session.designRefs ?? []
    if SessionReferences.any(in: session) {
      Menu {
        if let issue = session.linkedIssue {
          Button("\(issue.identifier) \(issue.title)", systemImage: Icon.issue) {
            router.push(.issue(ref: issue.identifier))
          }
        }
        if !designs.isEmpty {
          Section("Designs") {
            ForEach(designs, id: \.url) { design in
              Button(design.name, systemImage: Icon.design) {
                SessionReferences.open(design, in: session, router: router)
              }
            }
          }
        }
      } label: {
        Image(systemName: Icon.paperclip)
      }
      .accessibilityLabel("Ticket and designs")
    }
  }
}

enum SessionReferences {
  static func any(in session: RemoteSession) -> Bool {
    session.linkedIssue != nil || !(session.designRefs ?? []).isEmpty
  }

  @MainActor static func open(_ design: RemoteDesignRef, in session: RemoteSession, router: Router) {
    Telemetry.capture(.designOpened(source: .session))
    router.push(.design(url: design.url, sessionId: session.id))
  }
}
