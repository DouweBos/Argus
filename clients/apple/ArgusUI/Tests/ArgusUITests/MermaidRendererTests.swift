import Foundation
import Testing

@testable import ArgusUI

@Suite("Mermaid renderer")
@MainActor
struct MermaidRendererTests {
  static let diagrams = [
    "flowchart LR\n  A[Agent] --> B{Tests pass?}\n  B -- yes --> C[Merge]\n  B -- no --> A",
    "sequenceDiagram\n  participant P as Phone\n  participant H as Host\n  P->>H: files.read_bytes\n  H-->>P: base64",
    "classDiagram\n  class HostStore {\n    +readFile()\n  }",
    "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running",
    "erDiagram\n  SESSION ||--o{ AGENT : runs",
    "pie title Files\n  \"md\" : 3\n  \"pdf\" : 1",
    "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Build :a1, 2026-01-01, 3d",
  ]

  @Test func rendersEveryCommonDiagramInBothSchemes() async {
    for palette in [MermaidPalette.dark, .light] {
      for source in Self.diagrams {
        let outcome = await MermaidRenderer.shared.render(source, palette: palette)
        guard case .rendered(let diagram) = outcome else {
          Issue.record("\(source.prefix(20)): \(outcome)")
          continue
        }
        #expect(diagram.size.width > 20 && diagram.size.height > 20)
        #expect(PlatformImage(data: diagram.png) != nil)
        if let dir = ProcessInfo.processInfo.environment["MERMAID_DUMP"] { try? diagram.png.write(to: URL(fileURLWithPath: dir + "/\(palette == .dark ? "dark" : "light")-\(source.prefix(4)).png")) }
      }
    }
  }

  @Test func reportsInvalidSourceWithMermaidsMessage() async {
    let outcome = await MermaidRenderer.shared.render("flowchart LR\n  A --> ", palette: .dark)
    guard case .invalid(let message) = outcome else {
      Issue.record("rendered an invalid diagram")
      return
    }
    #expect(!message.isEmpty)
    #expect(MermaidRenderer.shared.cached("flowchart LR\n  A --> ", palette: .dark) != nil)
  }

  @Test func rasterizesAnSVGFile() async {
    let svg = #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="red"/></svg>"#
    let diagram = await MermaidRenderer.shared.rasterize(svg: Data(svg.utf8))
    #expect(diagram?.size == CGSize(width: 40, height: 20))
  }
}
