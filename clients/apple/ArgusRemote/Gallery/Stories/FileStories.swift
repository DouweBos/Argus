#if DEBUG
  import ArgusCore
  import ArgusKit
  import ArgusUI
  import PDFKit
  import SwiftUI

  /// Quick Open over a worktree's files, the Mac's ids.
  enum FileStories {
    /// Mermaid's first start outlasts the gallery's settle time on a simulator.
    static func warm(_ stage: GalleryStage) async {
      await MermaidRenderer.shared.prepare(
        [GalleryFixtures.previewFlowchart, GalleryFixtures.previewSequence, GalleryFixtures.previewBroken,
         previewReadmeDiagram],
        svgs: ["docs/badge-ci.svg", "docs/badge-coverage.svg"].compactMap(GalleryFixtures.previewFile))
    }

    /// The README's own fence, as `MarkdownBlock` hands it over.
    static var previewReadmeDiagram: String {
      MarkdownBlock.parse(GalleryFixtures.previewReadme).compactMap {
        if case .code("mermaid", let body) = $0 { body } else { nil }
      }.first ?? ""
    }

    static var all: [GalleryStory] {
      [
        GalleryStory("files/quick-open", fixtures: GalleryFixtures.files) {
          QuickOpenView(sessionId: "s1", label: "quick-open-polish")
        },
        GalleryStory("previews/markdown-readme", setup: warm) {
          MarkdownPreview(
            text: GalleryFixtures.previewReadme,
            document: MarkdownDocument(path: "README.md", loadFile: { GalleryFixtures.previewFile($0) }, open: { _ in }))
        },
        GalleryStory("previews/mermaid", setup: warm) {
          ScrollView {
            VStack(alignment: .leading, spacing: 16) {
              MermaidDiagramView(source: GalleryFixtures.previewFlowchart)
              MermaidDiagramView(source: GalleryFixtures.previewSequence)
              MermaidDiagramView(source: GalleryFixtures.previewBroken)
            }
            .padding(16)
          }
        },
        GalleryStory("previews/pdf") {
          PDFDocumentView(document: PDFDocument(data: GalleryFixtures.previewPDF())!)
        },
        GalleryStory("previews/transcript-mermaid", setup: warm) {
          ScrollView {
            MarkdownView(text: GalleryFixtures.previewTranscript).padding(16)
          }
        },
      ]
    }
  }
#endif
