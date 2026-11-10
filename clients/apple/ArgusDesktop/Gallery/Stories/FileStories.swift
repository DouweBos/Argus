#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// ⌘P Quick Open over a worktree's files.
  enum FileStories {
    static var all: [GalleryStory] {
      [
        quickOpen("files/quick-open", text: ""),
        quickOpen("files/quick-open/query", text: "quick"),
      ]
    }

    private static func quickOpen(_ id: String, text: String) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 640, height: 0), fixtures: GalleryFixtures.files) {
        QuickOpenStory(text: text)
      }
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
