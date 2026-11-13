import ArgusCore
import SwiftUI

/// A compare run's row in a session list, above its slots: the prompt's name and how many ran it.
public struct CompareRunHeaderRow: View {
  @Environment(\.theme) private var theme
  let run: CompareGroup
  var selected: Bool

  public init(run: CompareGroup, selected: Bool = false) {
    self.run = run
    self.selected = selected
  }

  public var body: some View {
    HStack(spacing: 8) {
      Image(systemName: Icon.compare)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(selected ? AnyShapeStyle(.primary) : AnyShapeStyle(theme.accent))
        .frame(width: 16)
      Text(run.title)
        .font(.scaled(.body))
        .foregroundStyle(selected ? AnyShapeStyle(.primary) : AnyShapeStyle(theme.text))
        .lineLimit(1)
      Spacer(minLength: 4)
      Text("×\(run.sessions.count)")
        .font(.scaled(.footnote).monospacedDigit())
        .foregroundStyle(selected ? AnyShapeStyle(.secondary) : AnyShapeStyle(theme.textMuted))
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Compare run, \(run.title), \(run.sessions.count) runners")
  }
}
