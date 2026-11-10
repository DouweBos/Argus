import ArgusUI
import Foundation
import UniformTypeIdentifiers

/// What the share sheet handed over: images become attachments, links and
/// text become the composer's opening draft.
struct SharedItems {
  var images: [PendingImage] = []
  var links: [String] = []
  var texts: [String] = []

  var draft: String { SharedPrompt.draft(links: links, texts: texts) }
  var isEmpty: Bool { images.isEmpty && links.isEmpty && texts.isEmpty }
  var hasLink: Bool { !links.isEmpty || texts.contains(where: SharedPrompt.isLink) }
  var hasText: Bool { texts.contains { !SharedPrompt.isLink($0.trimmingCharacters(in: .whitespacesAndNewlines)) } }

  @MainActor
  static func load(_ providers: [NSItemProvider]) async -> SharedItems {
    var items = SharedItems()
    for provider in providers {
      if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
        if let data = await provider.data(for: .image), let image = attachable(data) { items.images.append(image) }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        guard let url = await provider.url() else { continue }
        if url.isFileURL {
          if let image = ImageAttachments.pending(fromFile: url) { items.images.append(image) }
        } else {
          items.links.append(url.absoluteString)
        }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        if let text = await provider.text() { items.texts.append(text) }
      }
    }
    return items
  }

  /// Screenshots pass through as they are; HEIC and the like go as JPEG, under the gateway's frame limit.
  private static func attachable(_ data: Data) -> PendingImage? {
    guard let pending = ImageAttachments.pending(data: data) else { return nil }
    guard pending.attachment.mediaType == "image/png", !isPNG(data) else { return pending }
    return ImageAttachments.pending(photo: pending.preview) ?? pending
  }

  private static func isPNG(_ data: Data) -> Bool { data.starts(with: [0x89, 0x50, 0x4E, 0x47]) }
}

extension NSItemProvider {
  @MainActor fileprivate func data(for type: UTType) async -> Data? {
    await withCheckedContinuation { continuation in
      _ = loadDataRepresentation(for: type) { data, _ in continuation.resume(returning: data) }
    }
  }

  @MainActor fileprivate func url() async -> URL? {
    await withCheckedContinuation { continuation in
      loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
        continuation.resume(returning: item as? URL ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) })
      }
    }
  }

  @MainActor fileprivate func text() async -> String? {
    await withCheckedContinuation { continuation in
      loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
        continuation.resume(returning: item as? String ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) })
      }
    }
  }
}
