import ArgusCore
import ArgusKit
import SwiftUI

/// The frame next to a device screenshot at the same pixel size, one at a
/// time: the design, the screen, or where they differ.
struct DesignComparisonView: View {
  enum Pane: Hashable { case design, screen, diff }

  @Environment(\.theme) private var theme
  let comparison: HostStore.DesignComparison
  let percent: Int
  let deviceName: String?
  let onClose: () -> Void
  @State private var pane: Pane = .diff

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          Text(notOnScreen ? "Not on screen" : "\(percent)% of pixels differ")
            .font(.scaled(size: 14, weight: .semibold))
            .foregroundStyle(tone.color(theme))
          if notOnScreen {
            MutedText("Scroll the component into view, then compare again.", lineLimit: 2)
          } else if let deviceName {
            MutedText("Against \(deviceName)", lineLimit: 1)
          }
        }
        Spacer(minLength: 0)
        IconBtn(systemName: Icon.close, label: "Close compare", size: 13, action: onClose)
      }
      SegmentedControl(value: $pane, options: [(.design, "Design"), (.screen, "Screen"), (.diff, "Diff")])
      ZoomPanImage(data: Data(base64Encoded: image), label: label)
        .aspectRatio(max(comparison.width, 1) / max(comparison.height, 1), contentMode: .fit)
        .frame(maxHeight: 640)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    }
  }

  private var image: String {
    switch pane {
    case .design: comparison.design
    case .screen: comparison.screenshot
    case .diff: comparison.diff
    }
  }

  private var label: String {
    switch pane {
    case .design: "The design"
    case .screen: "The device's screen"
    case .diff: "Differences in red over the screen"
    }
  }

  /// A component frame the host couldn't find on the screenshot; its diff means nothing.
  private var notOnScreen: Bool { comparison.match?.found == false }

  /// Under 2% reads as a match, as the agents' compare tool treats it.
  private var tone: Tone {
    if notOnScreen { return .warning }
    return percent < 2 ? .success : percent < 10 ? .warning : .danger
  }
}
