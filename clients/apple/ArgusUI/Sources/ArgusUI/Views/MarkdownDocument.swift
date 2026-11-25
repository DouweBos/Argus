import ArgusCore
import SwiftUI

/// A Markdown file being previewed: where its relative images and links point,
/// and how to follow them. Transcripts have none, so they render as before.
public struct MarkdownDocument {
  /// Worktree-relative, the base for `![](img/a.png)` and `[guide](guide.md)`.
  public let path: String
  /// A worktree file's bytes, or nil when it can't be read.
  public let loadFile: @MainActor (String) async -> Data?
  /// A followed link: another file, a heading here, or the web.
  public let open: @MainActor (MarkdownTarget) -> Void

  public init(
    path: String, loadFile: @escaping @MainActor (String) async -> Data?,
    open: @escaping @MainActor (MarkdownTarget) -> Void
  ) {
    self.path = path
    self.loadFile = loadFile
    self.open = open
  }
}

extension EnvironmentValues {
  @Entry public var markdownDocument: MarkdownDocument?
}

/// `![alt](src)` standing alone in a paragraph, as READMEs put screenshots and badges.
enum MarkdownImageLine {
  struct Image: Equatable {
    let alt: String
    let source: String
  }

  /// The images when the paragraph is nothing but images; nil otherwise.
  static func images(in paragraph: String) -> [Image]? {
    var images: [Image] = []
    var rest = Substring(paragraph)
    while let match = rest.firstMatch(of: /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/) {
      guard rest[..<match.range.lowerBound].allSatisfy(\.isWhitespace) else { return nil }
      images.append(Image(alt: String(match.1), source: String(match.2)))
      rest = rest[match.range.upperBound...]
    }
    return images.isEmpty || !rest.allSatisfy(\.isWhitespace) ? nil : images
  }
}

/// A GFM task item's box: `[ ] `, `[x] `.
enum MarkdownTask {
  static func split(_ item: String) -> (checked: Bool, text: String)? {
    guard let match = item.prefixMatch(of: /\[([ xX])\]\s+/) else { return nil }
    return (match.1 != " ", String(item[match.range.upperBound...]))
  }
}

/// One image in a previewed document: a worktree file read through the host,
/// an SVG drawn by the same renderer as diagrams, or a web image.
struct MarkdownImageView: View {
  @Environment(\.theme) private var theme
  @Environment(\.markdownDocument) private var document
  let image: MarkdownImageLine.Image

  @State private var loaded: PlatformImage?
  @State private var failed = false

  var body: some View {
    Group {
      if let loaded {
        let size = loaded.size
        Image(platformImage: loaded)
          .resizable()
          .interpolation(.high)
          .scaledToFit()
          .frame(maxWidth: size.width, maxHeight: size.height)
          .accessibilityLabel(image.alt.isEmpty ? "Image" : image.alt)
      } else if failed {
        Label(image.alt.isEmpty ? image.source : image.alt, systemImage: "photo")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
      } else {
        ProgressView().controlSize(.small)
      }
    }
    .task(id: image.source) { await load() }
  }

  private func load() async {
    guard let document, let target = MarkdownTarget.resolve(image.source, from: document.path) else {
      failed = true
      return
    }
    let data: Data?
    let svg: Bool
    switch target {
    case .file(let path, _):
      data = await document.loadFile(path)
      svg = FilePreviewKind.isSVG(path)
    case .external(let url) where url.scheme == "https":
      data = try? await URLSession.shared.data(from: url).0
      svg = url.pathExtension.lowercased() == "svg"
    default:
      data = nil
      svg = false
    }
    guard let data else {
      failed = true
      return
    }
    if svg || data.starts(with: Data("<svg".utf8)) || data.starts(with: Data("<?xml".utf8)) {
      loaded = await MermaidRenderer.shared.rasterize(svg: data)?.image
    } else {
      loaded = PlatformImage(data: data)
    }
    failed = loaded == nil
  }
}

extension MermaidRenderer.Diagram {
  /// The bitmap at its point size, so it draws sharp on a Retina screen.
  public var image: PlatformImage? {
    #if canImport(UIKit)
      UIImage(data: png, scale: scale)
    #else
      NSImage(data: png).map { image in
        image.size = size
        return image
      }
    #endif
  }
}
