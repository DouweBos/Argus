#if DEBUG
  import ArgusCore
  import ArgusEditor
  import ArgusUI
  import SwiftUI

  /// The code view's editor and status bar with blame: a committed line, one with an edit nobody committed,
  /// and the inline annotation Settings → Editor turns on.
  enum CodeStories {
    static var all: [GalleryStory] {
      [
        story("code/status-bar/blame", line: 4, inline: false),
        story("code/status-bar/blame-uncommitted", line: 7, inline: false),
        story("code/inline-blame", line: 4, inline: true),
        story("code/attribution", line: 7, inline: false, attribution: true),
      ]
    }

    private static func story(_ id: String, line: Int, inline: Bool, attribution: Bool = false) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 900, height: 320)) {
        BlameStory(line: line, inline: inline, attribution: attribution)
      }
    }

    /// 0-based: an agent wrote the schema, a person added `effort` afterwards.
    static let attribution: [Int: LineAuthor] = [
      2: .agent, 3: .agent, 4: .agent, 5: .agent, 6: .agent, 7: .human, 8: .agent, 10: .agent,
    ]

    static let base = """
      import { z } from "zod";

      /// The request a client sends to start an agent.
      export const StartAgent = z.object({
        sessionId: z.string(),
        prompt: z.string().min(1),
        model: z.string().optional(),
      });

      export type StartAgent = z.infer<typeof StartAgent>;

      """

    /// `base` with a line added and not committed.
    static let edited = base.replacingOccurrences(
      of: "  model: z.string().optional(),\n",
      with: "  model: z.string().optional(),\n  effort: z.enum([\"low\", \"high\"]).optional(),\n")

    static func chunks(now: Date = .now) -> [ArgusProtocol.BlameChunk] {
      func chunk(_ sha: String, _ author: String, daysAgo: Double, _ start: Int, _ count: Int, _ summary: String)
        -> ArgusProtocol.BlameChunk
      {
        .init(
          author: author, authorEmail: "", authorTime: (now.timeIntervalSince1970 - daysAgo * 86_400) * 1000,
          commitHash: sha, lineCount: Double(count), lineStart: Double(start), summary: summary)
      }
      return [
        chunk("4f1c2a9e8b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e", "Maya Chen", daysAgo: 94, 1, 4, "Validate agent requests at the gateway"),
        chunk("9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b", "Ravi Patel", daysAgo: 3, 5, 2, "Require a prompt when starting an agent"),
        chunk("4f1c2a9e8b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e", "Maya Chen", daysAgo: 94, 7, 5, "Validate agent requests at the gateway"),
      ]
    }
  }

  private struct BlameStory: View {
    @Environment(DesktopModel.self) private var model
    let line: Int
    let inline: Bool
    var attribution = false
    @State private var stage: (code: CodeSession, file: CodeFile, document: EditorDocument)?

    var body: some View {
      VStack(spacing: 0) {
        if let stage {
          CodeEditorView(document: stage.document)
          Divider()
          CodeStatusBar(code: stage.code, file: stage.file, document: stage.document)
        }
      }
      .frame(width: 900, height: 320)
      .task { build() }
    }

    private func build() {
      let code = CodeSession(sessionId: "gallery-code", store: model.code)
      let file = CodeFile(path: "src/agents/startAgent.ts")
      let document = EditorDocument(
        text: CodeStories.edited, language: .typescript,
        configuration: AppPreferences.shared.editorSettings.configuration(applying: .init()))
      file.phase = .ready(document)
      file.language = .typescript
      file.hunks = CodeHunks(base: CodeStories.base, current: document.text)
      file.hunksVersion = document.version
      file.blame = BlameIndex(chunks: CodeStories.chunks())
      document.gitMarks = file.hunks?.marks ?? []
      if attribution { document.attribution = CodeStories.attribution }
      if inline {
        // The story shows the annotation whatever this Mac's setting is.
        document.lineAnnotation = { [weak file] line in
          file?.lineBlame(line).map { EditorLineAnnotation(text: $0.label(), action: {}) }
        }
      }
      document.select(EditorRange(EditorPosition(line: line, utf16Column: 12)))
      stage = (code, file, document)
    }
  }
#endif
