import ArgusCore
import ArgusUI
import SwiftUI

/// In the toolbar while this window is a second window on another app's host:
/// whose it is, and taking it over, which stays an explicit choice.
struct AttachedHostBadge: ToolbarContent {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  var body: some ToolbarContent {
    if let holder = model.supervisor.attachedTo {
      ToolbarItem(placement: .navigation) {
        Menu {
          Text("\(holder.holderName) runs the host on \(model.supervisor.configuration.home.path).")
          Text("Quitting this window leaves its agents running.")
          if !model.supervisor.configuration.attachOnly {
            Divider()
            Button("Quit \(holder.appName) and Take Over…") { model.confirmTakeOver(holder) }
          }
        } label: {
          Label("Attached to \(holder.appName)", systemImage: "link")
            .labelStyle(.titleAndIcon)
            .font(.scaled(.caption))
            .foregroundStyle(theme.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(theme.accentSoft, in: Capsule())
        }
        .menuIndicator(.hidden)
        .clickable()
        .fixedSize()
        .help("This window is attached to the Argus host \(holder.appName) runs")
      }
    }
  }
}
