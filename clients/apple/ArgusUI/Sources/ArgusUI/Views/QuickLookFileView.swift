import ArgusCore
import SwiftUI

#if os(macOS)
  import Quartz
#else
  import QuickLook
#endif

/// A document the system can preview (Word, Excel, PowerPoint, Keynote, Pages, Numbers), from
/// bytes read off the host: written to a private temporary file, since QuickLook only reads files.
public struct QuickLookFileView: View {
  @Environment(\.theme) private var theme
  let data: Data
  let name: String
  @State private var file: QuickLookFile?
  @State private var failed = false

  public init(data: Data, name: String) {
    self.data = data
    self.name = name
  }

  public var body: some View {
    Group {
      if let file {
        QuickLookRepresentable(url: file.url)
      } else if failed {
        EmptyState(icon: "doc.questionmark", title: "Can't preview this document", body: "It couldn't be saved for preview.")
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(theme.bg)
    .task(id: data) {
      file = QuickLookFile(data: data, name: name)
      failed = file == nil
    }
  }
}

/// A copy in its own temporary folder, removed with the preview.
final class QuickLookFile: Equatable, Sendable {
  let url: URL

  init?(data: Data, name: String) {
    let folder = FileManager.default.temporaryDirectory
      .appendingPathComponent("argus-preview", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let leaf = SessionFilePaths.fileName(name).replacingOccurrences(of: "/", with: "_")
    url = folder.appendingPathComponent(leaf.isEmpty ? "document" : leaf)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try data.write(to: url, options: [.atomic, .completeFileProtection])
    } catch {
      return nil
    }
  }

  deinit {
    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
  }

  static func == (lhs: QuickLookFile, rhs: QuickLookFile) -> Bool { lhs.url == rhs.url }
}

#if os(macOS)
  private struct QuickLookRepresentable: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> QLPreviewView {
      let view = QLPreviewView(frame: .zero, style: .normal) ?? QLPreviewView()
      view.autostarts = true
      return view
    }

    func updateNSView(_ view: QLPreviewView, context: Context) {
      if (view.previewItem as? NSURL) as URL? != url { view.previewItem = url as NSURL }
    }
  }
#else
  private struct QuickLookRepresentable: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Source { Source(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
      let controller = QLPreviewController()
      controller.dataSource = context.coordinator
      return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
      guard context.coordinator.url != url else { return }
      context.coordinator.url = url
      controller.reloadData()
    }

    final class Source: NSObject, QLPreviewControllerDataSource {
      var url: URL
      init(url: URL) { self.url = url }
      func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
      func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem {
        url as NSURL
      }
    }
  }
#endif
