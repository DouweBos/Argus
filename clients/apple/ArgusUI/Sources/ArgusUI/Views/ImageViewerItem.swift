import ArgusCore
import CoreGraphics
import Foundation

/// A transcript image's bytes, decoded once for whichever viewer shows it.
public struct ImageViewerItem {
  public let imageId: String
  public let data: Data?
  public let mediaType: String
  public let image: PlatformImage?

  public init(imageId: String, dataURI: String?) {
    self.imageId = imageId
    let parsed = dataURI.flatMap(Self.parse)
    data = parsed?.data
    mediaType = parsed?.mediaType ?? "image/png"
    image = data.flatMap(PlatformImage.init(data:))
  }

  @MainActor
  public init(store: HostStore, agentKey: String, imageId: String) {
    self.init(imageId: imageId, dataURI: store.cachedImage(agentId: agentKey, imageId: imageId))
  }

  /// A name to save or share it under; ids carry `:` and `/`.
  public var fileName: String {
    let ext = mediaType.split(separator: "/").last.map { $0 == "jpeg" ? "jpg" : String($0) } ?? "png"
    let stem = imageId.replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: "/", with: "-")
    return "argus-\(stem).\(ext)"
  }

  /// Within `room`, never past the image's own size.
  public func fitted(in room: CGSize) -> CGSize {
    Self.fit(image?.size ?? .zero, in: room)
  }

  static func fit(_ size: CGSize, in room: CGSize) -> CGSize {
    guard size.width > 0, size.height > 0 else { return CGSize(width: 240, height: 160) }
    let scale = min(1, room.width / size.width, room.height / size.height)
    return CGSize(
      width: max(1, (size.width * scale).rounded()), height: max(1, (size.height * scale).rounded()))
  }

  /// `data:<mime>;base64,…`; a bare `…,<base64>` decodes as PNG.
  public static func parse(_ uri: String) -> (data: Data, mediaType: String)? {
    guard let comma = uri.firstIndex(of: ","),
      let data = Data(base64Encoded: String(uri[uri.index(after: comma)...]))
    else { return nil }
    let header = uri.hasPrefix("data:") ? uri[uri.index(uri.startIndex, offsetBy: 5)..<comma] : ""
    let mediaType = header.split(separator: ";").first.map(String.init)
      .flatMap { $0.contains("/") ? $0 : nil } ?? "image/png"
    return (data, mediaType)
  }
}
