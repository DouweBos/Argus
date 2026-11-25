import ArgusCore
import SwiftUI

/// A Markdown file rendered as a reader sees it: the transcript's renderer in a
/// reading column, with `#anchor` links scrolling to their heading here.
public struct MarkdownPreview: View {
  @Environment(\.theme) private var theme
  let text: String
  let document: MarkdownDocument

  public init(text: String, document: MarkdownDocument) {
    self.text = text
    self.document = document
  }

  public var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        MarkdownView(text: text)
          .textSelection(.enabled)
          .frame(maxWidth: 820, alignment: .leading)
          .padding(.horizontal, 24)
          .padding(.vertical, 20)
          .frame(maxWidth: .infinity)
          .environment(
            \.markdownDocument,
            MarkdownDocument(path: document.path, loadFile: document.loadFile) { target in
              if case .anchor(let anchor) = target {
                withAnimation { proxy.scrollTo(anchor, anchor: .top) }
              } else {
                document.open(target)
              }
            })
      }
      .background(theme.bg)
    }
  }
}

/// An image file: a bitmap decoded here, an SVG drawn by the diagram renderer.
public struct ImageFilePreview: View {
  @Environment(\.theme) private var theme
  let data: Data
  let path: String
  @State private var png: Data?
  @State private var failed = false

  public init(data: Data, path: String) {
    self.data = data
    self.path = path
  }

  public var body: some View {
    Group {
      if let png {
        ZoomPanImage(data: png, label: SessionFilePaths.fileName(path))
      } else if failed {
        EmptyState(icon: "photo", title: "Can't show this image", body: "It isn't an image format this device can draw.")
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: data) {
      if FilePreviewKind.isSVG(path) {
        png = await MermaidRenderer.shared.rasterize(svg: data)?.png
      } else {
        png = PlatformImage(data: data) == nil ? nil : data
      }
      failed = png == nil
    }
  }
}
