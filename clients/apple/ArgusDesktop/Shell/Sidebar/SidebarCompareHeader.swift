import ArgusCore
import ArgusUI
import SwiftUI

/// A compare run's row above its slots: opens the run's side-by-side view.
struct SidebarCompareHeader: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let run: CompareGroup

  var body: some View {
    SidebarRow(selected: model.route == .compareRun(groupId: run.id)) {
      model.navigate(.compareRun(groupId: run.id))
    } content: {
      HStack(spacing: 4) {
        Image(systemName: Icon.compare)
          .font(.scaled(size: 10))
          .foregroundStyle(theme.textMuted)
          .frame(width: 10)
        Text(run.title)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.text)
          .lineLimit(1)
          .layoutPriority(1)
        Spacer(minLength: 4)
        Text("×\(run.sessions.count)")
          .font(.scaled(size: 11).monospacedDigit())
          .foregroundStyle(theme.textMuted)
          .fixedSize()
      }
      .padding(.vertical, 4)
      .accessibilityElement(children: .combine)
      .accessibilityLabel("Compare run, \(run.title), \(run.sessions.count) runners")
    }
    .help("Compare \(run.sessions.count) runs side by side")
  }
}
