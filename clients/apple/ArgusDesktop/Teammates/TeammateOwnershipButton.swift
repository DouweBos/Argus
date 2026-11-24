import ArgusCore
import ArgusUI
import SwiftUI

/// On an automation: the teammate it is a duty of, or a menu to make it one.
/// Moving it moves its memories into the teammate's.
struct TeammateOwnershipButton: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var teammates
  @Environment(AutomationsStore.self) private var automations
  let automation: RemoteAutomation

  var body: some View {
    Group {
      if let id = automation.teammateId {
        Button {
          model.navigate(.teammate(id: id, page: .duties))
        } label: {
          Label(teammates.teammate(id)?.name ?? "Teammate", systemImage: Icon.teammates)
        }
        .labelStyle(.titleAndIcon)
        .help("This automation is a duty of this teammate")
      } else {
        Menu("Move to Teammate") {
          Button("New Teammate") { Task { await move(into: nil) } }
          if !teammates.summaries.isEmpty { Divider() }
          ForEach(teammates.summaries) { summary in
            Button(summary.teammate.name) { Task { await move(into: summary.teammate.id) } }
          }
        }
        .clickable()
        .help("Make this a duty of a teammate; its memories go with it")
      }
    }
    .task { if !teammates.loaded { await teammates.refresh() } }
  }

  private func move(into teammateId: String?) async {
    guard let teammate = await teammates.promote(automationId: automation.id, into: teammateId) else { return }
    await automations.refresh()
    model.navigate(.teammate(id: teammate.id, page: .duties))
  }
}
