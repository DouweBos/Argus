#if DEBUG
  import ArgusCore
  import ArgusUI
  import PDFKit
  import SwiftUI

  /// ⌘P Quick Open over a worktree's files.
  enum FileStories {
    static var all: [GalleryStory] {
      [
        quickOpen("files/quick-open", text: ""),
        quickOpen("files/quick-open/query", text: "quick"),
        GalleryStory("previews/markdown-readme", size: CGSize(width: 820, height: 1400)) {
          MarkdownPreview(text: GalleryFixtures.previewReadme, document: PreviewStories.document)
        },
        GalleryStory("previews/mermaid", size: CGSize(width: 720, height: 1100)) {
          PreviewStories.diagrams.padding(20)
        },
        GalleryStory("previews/pdf", size: CGSize(width: 720, height: 900)) {
          PDFDocumentView(document: PDFDocument(data: GalleryFixtures.previewPDF())!)
        },
        GalleryStory("previews/large-file", size: CGSize(width: 900, height: 560)) {
          LargeFileView(pager: GalleryFixtures.previewLargePager(), limitation: "edit")
        },
        GalleryStory("previews/transcript-mermaid", size: CGSize(width: 720, height: 1100)) {
          TranscriptMermaidStory()
          .padding(20)
            .frame(maxHeight: .infinity, alignment: .top)
        },
      ]
    }

    private static func quickOpen(_ id: String, text: String) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 640, height: 0), fixtures: GalleryFixtures.files) {
        QuickOpenStory(text: text)
      }
    }
  }

  /// What the preview stories share with the phone's.
  @MainActor
  enum PreviewStories {
    static var document: MarkdownDocument {
      MarkdownDocument(
        path: "README.md", loadFile: { GalleryFixtures.previewFile($0) }, open: { _ in })
    }

    static var diagrams: some View {
      VStack(alignment: .leading, spacing: 16) {
        MermaidDiagramView(source: GalleryFixtures.previewFlowchart)
        MermaidDiagramView(source: GalleryFixtures.previewSequence)
        MermaidDiagramView(source: GalleryFixtures.previewBroken)
      }
      .frame(maxHeight: .infinity, alignment: .top)
    }
  }

  /// A reply holding diagrams, re-measured as each one draws, as a transcript row is.
  private struct TranscriptMermaidStory: View {
    @State private var rendered = TranscriptMarkdown.render(markdown: GalleryFixtures.previewTranscript)

    var body: some View {
      TranscriptMessageText(rendered: rendered, unit: nil, diagramsDrawn: MermaidRenders.shared.count)
    }
  }

  private struct QuickOpenStory: View {
    @Environment(HostStore.self) private var host
    let text: String
    @State private var code: CodeSession?

    var body: some View {
      Group {
        if let code { QuickOpenView(code: code) } else { Color.clear.frame(height: 420) }
      }
      .padding(20)
      .task {
        let session = CodeSession(sessionId: "s1", store: CodeStore(host: host))
        await session.loadFileList(force: true)
        session.quickOpen.text = text
        code = session
      }
    }
  }
#endif
