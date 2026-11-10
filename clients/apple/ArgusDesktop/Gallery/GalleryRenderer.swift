#if DEBUG
  import AppKit
  import ArgusCore
  import SwiftUI

  /// `ARGUS_GALLERY=render`: renders every story matching `ARGUS_GALLERY_FILTER`
  /// in each of `ARGUS_GALLERY_THEMES` to `ARGUS_GALLERY_OUT`, writes
  /// `index.json`, and exits. Windows sit below the desktop, so nothing ever
  /// shows or takes focus; a window capture still reads their buffers.
  @MainActor
  enum GalleryRenderer {
    struct Entry: Encodable {
      let id: String
      let theme: String
      let path: String
      let unanswered: [String]
    }

    static func run(model: DesktopModel) {
      let env = ProcessInfo.processInfo.environment
      let out = URL(fileURLWithPath: env["ARGUS_GALLERY_OUT"] ?? NSTemporaryDirectory() + "argus-gallery")
      let filter = env["ARGUS_GALLERY_FILTER"] ?? ""
      let themes = (env["ARGUS_GALLERY_THEMES"] ?? "dark,light").split(separator: ",").map(String.init)
      let stories = GalleryStories.all.filter { filter.isEmpty || $0.id.contains(filter) }
      try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
      Task {
        var entries: [Entry] = []
        for story in stories {
          for theme in themes {
            entries.append(await render(story, theme: theme, model: model, into: out))
          }
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        try? encoder.encode(entries).write(to: out.appendingPathComponent("index.json"))
        if stories.isEmpty { FileHandle.standardError.write(Data("no story matches \"\(filter)\"\n".utf8)) }
        exit(stories.isEmpty ? 1 : 0)
      }
    }

    static func render(_ story: GalleryStory, theme: String, model: DesktopModel, into out: URL) async -> Entry {
      let stage = await GalleryStage(story: story, model: model)
      let hosting = NSHostingView(rootView: stage.view(story))
      let size = measured(story, stage.view(story))
      let window = NSWindow(
        contentRect: NSRect(origin: NSPoint(x: 80, y: 80), size: size),
        styleMask: story.chrome ? [.titled, .closable, .resizable, .fullSizeContentView] : [.borderless],
        backing: .buffered, defer: false)
      window.isReleasedWhenClosed = false
      window.appearance = NSAppearance(named: theme == "light" ? .aqua : .darkAqua)
      window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) - 1)
      window.collectionBehavior.insert(.canJoinAllSpaces)
      window.contentView = hosting
      window.orderFrontRegardless()
      // Lets `.task`s load from the fixtures and the layout settle.
      try? await Task.sleep(for: .milliseconds(700))

      // AppKit lists (an `NSTableView`) only tile their rows in a display pass, which a window below the desktop never gets.
      window.layoutIfNeeded()
      window.display()
      try? await Task.sleep(for: .milliseconds(100))
      window.display()

      let slug = story.id.replacingOccurrences(of: "/", with: "-")
      let file = out.appendingPathComponent("\(slug).\(theme).png")
      if !capture(window, to: file) { snapshot(hosting, to: file) }
      window.orderOut(nil)
      window.close()
      await stage.host.detach()
      return Entry(id: story.id, theme: theme, path: file.path, unanswered: stage.backend.unanswered)
    }

    private static func measured(_ story: GalleryStory, _ view: some View) -> CGSize {
      guard story.size.height == 0 else { return story.size }
      let fit = NSHostingController(rootView: view).sizeThatFits(in: CGSize(width: story.size.width, height: .infinity))
      return CGSize(width: story.size.width, height: max(1, ceil(fit.height)))
    }

    /// The whole window, title bar and toolbar included.
    private static func capture(_ window: NSWindow, to file: URL) -> Bool {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
      process.arguments = ["-x", "-o", "-l", "\(window.windowNumber)", file.path]
      guard (try? process.run()) != nil else { return false }
      process.waitUntilExit()
      return process.terminationStatus == 0 && FileManager.default.fileExists(atPath: file.path)
    }

    /// Without screen-recording permission: the content view alone, drawn offscreen.
    private static func snapshot(_ view: NSView, to file: URL) {
      guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
      view.cacheDisplay(in: view.bounds, to: rep)
      try? rep.representation(using: .png, properties: [:])?.write(to: file)
    }
  }
#endif
