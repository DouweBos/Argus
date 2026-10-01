import ArgusKit
import Foundation
import UniformTypeIdentifiers

#if canImport(UIKit)
  import UIKit
#else
  import AppKit
#endif

/// An image waiting to go out with the next message.
public struct PendingImage: Identifiable {
  public let id = UUID()
  public var preview: PlatformImage
  public var attachment: RemoteImageAttachment
}

/// Turns pasted, dropped and picked images into the `{data, media_type}`
/// attachment every client sends. The bytes go out as they are, as on the
/// desktop; formats the API can't read are re-encoded as PNG.
public enum ImageAttachments {
  /// What the attach dialog offers, and what passes through untouched.
  public static let acceptedTypes: [UTType] = [.png, .jpeg, .gif, .webP]

  public static func isImage(_ url: URL) -> Bool {
    (UTType(filenameExtension: url.pathExtension)?.conforms(to: .image)) ?? false
  }

  public static func pending(fromFile url: URL) -> PendingImage? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return pending(data: data, type: UTType(filenameExtension: url.pathExtension))
  }

  public static func pending(data: Data, type: UTType?) -> PendingImage? {
    guard let image = PlatformImage(data: data) else { return nil }
    if let type, let accepted = acceptedTypes.first(where: { type.conforms(to: $0) }),
      let mime = accepted.preferredMIMEType
    {
      return PendingImage(
        preview: image,
        attachment: RemoteImageAttachment(data: data.base64EncodedString(), mediaType: mime))
    }
    guard let png = pngData(image) else { return nil }
    return PendingImage(
      preview: image,
      attachment: RemoteImageAttachment(data: png.base64EncodedString(), mediaType: "image/png"))
  }

  private static func pngData(_ image: PlatformImage) -> Data? {
    #if canImport(UIKit)
      image.pngData()
    #else
      image.tiffRepresentation
        .flatMap(NSBitmapImageRep.init(data:))?
        .representation(using: .png, properties: [:])
    #endif
  }
}
