import ArgusCore
import SwiftUI

/// An Artifact as the agent published it: a slim bar (title, reload, open in
/// the browser) over the live page. Give it `.id(link.url)` so a new page gets
/// a fresh web view.
public struct ArtifactViewer: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  let link: ArtifactLink
  /// A sheet's close button; the Mac panel's tab closes itself.
  var onClose: (() -> Void)?
  @State private var page: ArtifactPage

  public init(link: ArtifactLink, onClose: (() -> Void)? = nil) {
    self.link = link
    self.onClose = onClose
    _page = State(initialValue: ArtifactPage(url: link.url))
  }

  public var body: some View {
    VStack(spacing: 0) {
      bar
      Divider()
      ArtifactWebView(page: page)
        .overlay {
          if let failure = page.failure {
            EmptyState(icon: Icon.warning, title: "Couldn't load the artifact", body: failure) {
              Button("Try Again") { page.reload() }
            }
            .background(theme.bg)
          }
        }
    }
    .background(theme.bg)
  }

  private var bar: some View {
    HStack(spacing: 6) {
      Image(systemName: Icon.artifact)
        .font(.scaled(size: 11, weight: .semibold))
        .foregroundStyle(theme.accent)
      Text(link.title)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.text)
        .lineLimit(1)
      if page.isLoading { ProgressView().controlSize(.mini) }
      Spacer(minLength: 4)
      IconBtn(systemName: Icon.refresh, label: "Reload", size: iconSize) { page.reload() }
        .help("Reload the artifact")
      IconBtn(systemName: Icon.openExternal, label: "Open in Browser", size: iconSize) { openURL(link.url) }
        .help("Open the artifact in your browser")
      if let onClose {
        IconBtn(systemName: Icon.close, label: "Close", size: iconSize, action: onClose)
      }
    }
    .padding(.horizontal, 10)
    .frame(height: barHeight)
  }

  private var barHeight: CGFloat {
    #if os(iOS)
      48
    #else
      30
    #endif
  }

  private var iconSize: CGFloat {
    #if os(iOS)
      15
    #else
      11
    #endif
  }
}

extension View {
  /// Opens a transcript's Artifacts in a sheet over it; `opened` hears each one.
  public func artifactSheet(opened: @escaping @MainActor () -> Void = {}) -> some View {
    modifier(ArtifactSheet(opened: opened))
  }
}

private struct ArtifactSheet: ViewModifier {
  let opened: @MainActor () -> Void
  @State private var shown: ArtifactLink?

  func body(content: Content) -> some View {
    content
      .environment(
        \.openArtifact,
        OpenArtifactAction { link in
          shown = link
          opened()
        })
      .argusSheet(item: $shown) { link in
        ArtifactViewer(link: link) { shown = nil }
          .presentationDragIndicator(.visible)
      }
  }
}

extension ArtifactLink: @retroactive Identifiable {
  public var id: URL { url }
}
