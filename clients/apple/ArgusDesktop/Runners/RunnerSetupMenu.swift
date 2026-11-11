import ArgusCore
import ArgusUI
import SwiftUI

/// "Set Up a Runner…" beside a runner picker: install a missing runner's CLI,
/// or sign in to one that's installed. Hidden when there's nothing to set up.
struct RunnerSetupMenu: View {
  let flows: [RunnerSetupFlow]
  let window: RunnerSetupModel.Window
  @Environment(DesktopModel.self) private var model

  var body: some View {
    let missing = flows.filter { !$0.installed }
    let installed = flows.filter { $0.installed && $0.setup.loginCommand != nil }
    if !missing.isEmpty || !installed.isEmpty {
      Menu("Set Up a Runner…") {
        if !missing.isEmpty {
          Section("Install") { items(missing) }
        }
        if !installed.isEmpty {
          Section("Sign In") { items(installed) }
        }
      }
      .fixedSize()
      .clickable()
    }
  }

  private func items(_ flows: [RunnerSetupFlow]) -> some View {
    ForEach(flows) { flow in
      Button(flow.displayName) { model.runnerSetup.begin(flow, in: window) }
    }
  }
}
