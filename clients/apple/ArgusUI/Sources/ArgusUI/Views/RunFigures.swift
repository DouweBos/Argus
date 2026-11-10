import SwiftUI

/// A run's figures — duration, cost, when — as the Mac's run screen shows
/// them, wrapping onto a second line on a narrow phone.
public struct RunFigures: View {
  @Environment(\.theme) private var theme
  let figures: [(label: String, value: String)]

  public init(_ figures: [(label: String, value: String)]) {
    self.figures = figures
  }

  public var body: some View {
    FlowRow(spacing: 28, rowSpacing: 12, packed: true) {
      ForEach(Array(figures.enumerated()), id: \.offset) { _, figure in
        VStack(alignment: .leading, spacing: 2) {
          Text(figure.label).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
          Text(figure.value).font(.scaled(.title3).weight(.semibold)).monospacedDigit()
            .foregroundStyle(theme.text).textSelection(.enabled)
        }
      }
    }
  }
}
