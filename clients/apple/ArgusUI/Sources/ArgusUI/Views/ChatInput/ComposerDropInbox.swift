#if os(macOS)
  import AppKit
  import SwiftUI
  import UniformTypeIdentifiers

  /// Images and files dropped anywhere on the chat, handed to its composer as
  /// if they'd landed on the field itself.
  @MainActor
  @Observable
  public final class ComposerDropInbox {
    public static let types: [UTType] = [.fileURL, .image]

    /// Bumped per delivery; the composer drains `pending` when it changes.
    private(set) var generation = 0
    private var pending: [ComposerDrop] = []

    public init() {}

    /// What `onDrop` gets; false when nothing in it is a file or an image.
    public func accept(_ providers: [NSItemProvider]) -> Bool {
      let usable = providers.filter { provider in
        Self.types.contains { provider.hasItemConformingToTypeIdentifier($0.identifier) }
      }
      guard !usable.isEmpty else { return false }
      Task {
        if let drop = await Self.drop(from: usable) { deliver(drop) }
      }
      return true
    }

    func deliver(_ drop: ComposerDrop) {
      pending.append(drop)
      generation += 1
    }

    func take() -> [ComposerDrop] {
      defer { pending = [] }
      return pending
    }

    /// Files win over image data, as on the field: a file's drag also carries its icon.
    static func drop(from providers: [NSItemProvider]) async -> ComposerDrop? {
      var urls: [URL] = []
      var images: [PendingImage] = []
      for provider in providers {
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
          if let url = await fileURL(from: provider) { urls.append(url) }
        } else if let image = await image(from: provider) {
          images.append(image)
        }
      }
      if !urls.isEmpty {
        let pictures = urls.filter(ImageAttachments.isImage).compactMap(ImageAttachments.pending(fromFile:))
        if !pictures.isEmpty, pictures.count == urls.count { return .images(pictures, pasted: false) }
        return .files(urls)
      }
      return images.isEmpty ? nil : .images(images, pasted: false)
    }

    private static func fileURL(from provider: NSItemProvider) async -> URL? {
      await withCheckedContinuation { done in
        _ = provider.loadObject(ofClass: URL.self) { url, _ in
          done.resume(returning: url?.isFileURL == true ? url : nil)
        }
      }
    }

    private static func image(from provider: NSItemProvider) async -> PendingImage? {
      guard let type = provider.registeredContentTypes.first(where: { $0.conforms(to: .image) }) else {
        return nil
      }
      let data: Data? = await withCheckedContinuation { done in
        _ = provider.loadDataRepresentation(for: type) { data, _ in done.resume(returning: data) }
      }
      return data.flatMap { ImageAttachments.pending(data: $0, type: type) }
    }
  }

  extension EnvironmentValues {
    /// Where the chat around a composer sends what's dropped on it.
    @Entry public var composerDropInbox: ComposerDropInbox?
  }
#endif
