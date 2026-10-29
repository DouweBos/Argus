import ArgusCore
import ArgusUI
import SwiftUI

/// In the sidebar's foot while this window is a second window on another
/// app's host: whose it is, and taking it over, which stays an explicit choice.
struct AttachedHostButton: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    if let holder = model.supervisor.attachedTo {
      Menu {
        Text("Attached to \(holder.appName)")
        Text("\(holder.holderName) runs the host on \(model.supervisor.configuration.home.path).")
        Text("Quitting this window leaves its agents running.")
        if !model.supervisor.configuration.attachOnly {
          Divider()
          Button("Quit \(holder.appName) and Take Over…") { model.confirmTakeOver(holder) }
        }
      } label: {
        Image(systemName: "link")
      }
      .menuStyle(.button)
      .clickable()
      .buttonStyle(FlatIconButtonStyle(size: 28))
      .menuIndicator(.hidden)
      .fixedSize()
      .help("Attached to the Argus host \(holder.appName) runs")
      .accessibilityLabel("Attached to \(holder.appName)")
    }
  }
}
