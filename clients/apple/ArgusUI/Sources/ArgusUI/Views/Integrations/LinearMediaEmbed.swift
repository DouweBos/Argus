import AVKit
import ArgusKit
import SwiftUI

/// Fetches a Linear upload as a local file. Unset (the default), uploads stay links —
/// a screen opts in when its host can hand it the file.
public struct LinearMediaLoader {
  let load: @MainActor (String) async throws -> URL?

  public init(_ load: @escaping @MainActor (String) async throws -> URL?) {
    self.load = load
  }
}

extension EnvironmentValues {
  @Entry public var linearMedia: LinearMediaLoader?
}

/// A Linear screenshot or screen recording inline, loaded through the host's signed-in copy.
struct LinearMediaEmbed: View {
  @Environment(\.theme) private var theme
  @Environment(\.linearMedia) private var loader
  let link: LinearMediaLink
  @State private var phase: Phase = .loading

  private enum Phase {
    case loading
    case image(PlatformImage)
    case video(AVPlayer, aspect: CGFloat)
    case failed
  }

  private var name: String { link.label.isEmpty ? (link.kind == .video ? "Video" : "Image") : link.label }

  var body: some View {
    Group {
      switch phase {
      case .loading: placeholder(failed: false)
      case .failed: placeholder(failed: true)
      case .image(let image):
        Image(platformImage: image)
          .resizable()
          .scaledToFit()
          .frame(maxWidth: image.size.width)
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          .accessibilityLabel(name)
      case .video(let player, let aspect):
        VideoPlayer(player: player)
          .aspectRatio(aspect, contentMode: .fit)
          .frame(maxHeight: 480)
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          .onDisappear { player.pause() }
          .accessibilityLabel(name)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .task(id: link.url) { await load() }
  }

  private func placeholder(failed: Bool) -> some View {
    HStack(spacing: 8) {
      Image(systemName: failed ? Icon.warning : (link.kind == .video ? "film" : Icon.image))
        .font(.scaled(size: 13))
        .foregroundStyle(theme.textMuted)
      Text(name).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(1)
      Spacer(minLength: 8)
      if failed {
        if let url = URL(string: link.url) {
          Link("Open", destination: url).font(.scaled(size: 12)).clickable()
        }
      } else {
        ProgressView().controlSize(.small)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.borderSubtle, lineWidth: 1))
    .accessibilityElement(children: .combine)
    .accessibilityLabel(failed ? "\(name), couldn't load" : "Loading \(name)")
  }

  private func load() async {
    phase = .loading
    guard let loader, let file = try? await loader.load(link.url) else {
      phase = .failed
      return
    }
    switch link.kind {
    case .image:
      let data = try? await Task.detached { try Data(contentsOf: file) }.value
      phase = data.flatMap(PlatformImage.init(data:)).map(Phase.image) ?? .failed
    case .video:
      phase = .video(AVPlayer(url: file), aspect: await Self.aspect(of: file))
    }
  }

  /// Width over height as the recording plays, rotation included; 16:9 when unknown.
  private static func aspect(of file: URL) async -> CGFloat {
    let asset = AVURLAsset(url: file)
    guard let track = try? await asset.loadTracks(withMediaType: .video).first,
      let (size, transform) = try? await track.load(.naturalSize, .preferredTransform)
    else { return 16 / 9 }
    let shown = size.applying(transform)
    let width = abs(shown.width)
    let height = abs(shown.height)
    return width > 0 && height > 0 ? width / height : 16 / 9
  }
}
