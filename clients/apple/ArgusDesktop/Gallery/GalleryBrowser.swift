#if DEBUG
  import AppKit
  import ArgusUI
  import SwiftUI

  /// `ARGUS_GALLERY=browse`: every story in a window — pick one, flip the theme,
  /// interact with it live against its fixtures.
  @MainActor
  enum GalleryBrowser {
    private static var window: NSWindow?

    static func open(model: DesktopModel) {
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
        styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
        backing: .buffered, defer: false)
      window.title = "Argus Gallery"
      window.isReleasedWhenClosed = false
      window.contentView = NSHostingView(rootView: GalleryBrowserView(model: model))
      window.center()
      window.makeKeyAndOrderFront(nil)
      NSApp.setActivationPolicy(.regular)
      NSApp.activate()
      self.window = window
    }
  }

  private struct GalleryBrowserView: View {
    let model: DesktopModel
    @State private var selection: String? = GalleryStories.all.first?.id
    @State private var dark = true

    private var story: GalleryStory? { GalleryStories.all.first { $0.id == selection } }

    var body: some View {
      NavigationSplitView {
        List(GalleryStories.all, selection: $selection) { story in
          Text(story.id).font(.system(.body, design: .monospaced)).tag(story.id)
        }
        .navigationSplitViewColumnWidth(min: 220, ideal: 280)
      } detail: {
        if let story {
          GalleryStoryHost(story: story, model: model)
            .id("\(story.id)-\(dark)")
            .frame(
              width: story.size.width,
              height: story.size.height == 0 ? nil : story.size.height)
            .clipShape(.rect(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .environment(\.colorScheme, dark ? .dark : .light)
        }
      }
      .toolbar {
        Picker("Theme", selection: $dark) {
          Text("Dark").tag(true)
          Text("Light").tag(false)
        }
        .pickerStyle(.segmented)
      }
    }
  }

  private struct GalleryStoryHost: View {
    let story: GalleryStory
    let model: DesktopModel
    @State private var stage: GalleryStage?

    var body: some View {
      Group {
        if let stage { stage.view(story) } else { ProgressView() }
      }
      .task { stage = await GalleryStage(story: story, model: model) }
    }
  }
#endif
