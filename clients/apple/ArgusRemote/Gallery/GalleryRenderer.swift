#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI
  import UIKit

  /// Renders every story matching `ARGUS_GALLERY_FILTER` in each of
  /// `ARGUS_GALLERY_THEMES` to `ARGUS_GALLERY_OUT` (a path on the Mac: the
  /// simulator shares its file system), writes `index.json`, and exits.
  /// Drawn from the app's own window, so menus, text views and materials render as they ship.
  struct GalleryRoot: View {
    struct Entry: Encodable {
      let id: String
      let theme: String
      let path: String
      let unanswered: [String]
    }

    @State private var stage: GalleryStage?
    @State private var story: GalleryStory?
    @State private var light = false
    /// A component's own height, measured, so its PNG is cropped to it.
    @State private var contentHeight: CGFloat = 0

    private var theme: Theme { light ? Theme.light : Theme.dark }

    var body: some View {
      // Never empty: an empty root never appears, so its `.task` would never run.
      ZStack {
        theme.bg.ignoresSafeArea()
        if let stage, let story {
          if story.screen {
            stage.view(story, theme: theme)
          } else {
            VStack(spacing: 0) {
              stage.view(story, theme: theme)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
              Spacer(minLength: 0)
            }
          }
        }
      }
      .preferredColorScheme(light ? .light : .dark)
      .task { await run() }
    }

    private func run() async {
      let out = URL(fileURLWithPath: GalleryMode.value("ARGUS_GALLERY_OUT") ?? NSTemporaryDirectory() + "argus-gallery-ios")
      let filter = GalleryMode.value("ARGUS_GALLERY_FILTER") ?? ""
      let themes = (GalleryMode.value("ARGUS_GALLERY_THEMES") ?? "dark,light").split(separator: ",").map(String.init)
      let stories = GalleryStories.all.filter { filter.isEmpty || $0.id.contains(filter) }
      try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
      var entries: [Entry] = []
      for next in stories {
        for name in themes {
          let fresh = await GalleryStage(story: next)
          light = name == "light"
          contentHeight = 0
          stage = fresh
          story = next
          // Lets `.task`s load from the fixtures and the layout settle.
          try? await Task.sleep(for: .milliseconds(900))
          let slug = next.id.replacingOccurrences(of: "/", with: "-")
          let file = out.appendingPathComponent("\(slug).\(name).png")
          capture(cropHeight: next.screen ? nil : contentHeight, to: file)
          entries.append(Entry(id: next.id, theme: name, path: file.path, unanswered: fresh.backend.unanswered))
          story = nil
          stage = nil
          await fresh.host.detach()
        }
      }
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
      try? encoder.encode(entries).write(to: out.appendingPathComponent("index.json"))
      exit(stories.isEmpty ? 1 : 0)
    }

    private func capture(cropHeight: CGFloat?, to file: URL) {
      guard
        let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
          .flatMap(\.windows).first(where: \.isKeyWindow)
      else { return }
      var bounds = window.bounds
      if let cropHeight, cropHeight > 0 {
        bounds.size.height = min(bounds.height, cropHeight + window.safeAreaInsets.top)
      }
      let image = UIGraphicsImageRenderer(bounds: bounds).image { _ in
        window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
      }
      try? image.pngData()?.write(to: file)
    }
  }
#endif
