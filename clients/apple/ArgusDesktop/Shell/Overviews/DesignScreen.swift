import ArgusCore
import ArgusUI
import SwiftUI

/// `/design?url=&session=`: a Figma frame in the design viewer. Opened for a
/// session, it flags a design that moved on and compares against the
/// session's simulator.
struct DesignScreen: View {
  @Environment(HostStore.self) private var store
  let url: String
  let sessionId: String?

  var body: some View {
    DesignScreenContent(
      model: DesignViewerModel(
        url: url, sessionVersion: session.flatMap { DesignViewerModel.sessionVersion(of: url, in: $0) }, host: store),
      session: session)
  }

  private var session: RemoteSession? { sessionId.flatMap(store.loadedSession(id:)) }
}

private struct DesignScreenContent: View {
  @Environment(DesktopModel.self) private var desktop
  @Environment(RuntimeModel.self) private var runtime
  @State private var model: DesignViewerModel
  let session: RemoteSession?

  init(model: DesignViewerModel, session: RemoteSession?) {
    _model = State(initialValue: model)
    self.session = session
  }

  var body: some View {
    DesignViewerView(
      model: model, compareTargets: session == nil ? nil : targets,
      compareHint: isLocal
        ? "Pick a running simulator or emulator for this session in the runtime panel."
        : "Compare works against this Mac's simulators.")
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .navigationTitle(model.details?.frame.name ?? "Design")
      .navigationSubtitle(model.details?.file.name ?? "")
      .toolbar {
        if let session {
          ToolbarItem {
            Button {
              desktop.openAgents(session: session.id)
            } label: {
              Label("Back to Session", systemImage: Icon.agent)
            }
            .help("Back to the session's agents")
          }
        }
      }
      .task { if session != nil, isLocal { await runtime.refresh() } }
  }

  private var isLocal: Bool { session.map { desktop.host(ofSession: $0.id) == Hosts.local } ?? true }

  /// The session's picked simulator and emulator, while they run.
  private var targets: [DesignCompareTarget] {
    guard let session, isLocal else { return [] }
    var found: [DesignCompareTarget] = []
    if let sim = runtime.simulator(runtime.selectedDevice(platform: .ios, session: session.id)), sim.booted {
      found.append(DesignCompareTarget(platform: .ios, deviceKey: sim.udid, name: sim.name))
    }
    if let device = runtime.androidDevice(runtime.selectedDevice(platform: .android, session: session.id)),
      device.online
    {
      found.append(DesignCompareTarget(platform: .android, deviceKey: device.serial, name: device.name))
    }
    return found
  }
}
