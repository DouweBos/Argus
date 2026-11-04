import AppKit
import Foundation
import Testing

@testable import Argus

/// A streamed fence grows line by line in one block view; its text view must
/// grow with it, or every line past the first sizes draws blank.
@MainActor
struct TranscriptCodeBlockTests {
  private static let lines = [
    "      - name: Let SwiftPM fetch Grove",
    "        if: ${{ steps.stage.outputs.has_changes == 'true' && github.event.inputs.app == 'mac' }}",
    "        env:",
    "          GROVE_TOKEN: ${{ secrets.GROVE_TOKEN }}",
    "        run: |",
    "          git config --global \\",
    "            url.\"https://x-access-token:${GROVE_TOKEN}@github.com/DouweBos/Grove.git\".insteadOf \\",
    "            \"https://github.com/DouweBos/Grove.git\"",
  ]

  private static func fence(_ count: Int) -> NSAttributedString {
    let rendered = TranscriptMarkdown.render(markdown: "```yaml\n" + lines.prefix(count).joined(separator: "\n") + "\n```")
    guard case .code(_, let text) = rendered.parts.first else { fatalError("no code part") }
    return text
  }

  @Test func textGrowsWithAStreamedBlock() {
    let view = TranscriptCodeBlockView()
    let width: CGFloat = 400
    for count in 1...Self.lines.count {
      let text = Self.fence(count)
      view.setContent(text)
      view.frame = NSRect(x: 0, y: 0, width: width, height: TranscriptCodeBlockView.height(of: text, width: width))
      view.layoutSubtreeIfNeeded()
      #expect(view.text.frame.height >= TextMeasurer.size(of: text, width: nil).height, "after line \(count)")
      // The text view trims itself to its used width, unrounded.
      #expect(view.text.frame.width >= TranscriptCodeBlockView.naturalWidth(of: text) - 1, "after line \(count)")
    }
  }
}
