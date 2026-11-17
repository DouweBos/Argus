import SwiftUI

/// A non-image file waiting to go out with the next message.
public struct PendingFile: Identifiable, Sendable, Equatable {
  public let id: UUID
  public let name: String
  public let size: Int
  /// Where the session's agent reads it; nil while it uploads.
  public var path: String?

  public init(id: UUID = UUID(), name: String, size: Int, path: String? = nil) {
    self.id = id
    self.name = name
    self.size = size
    self.path = path
  }

  public var isUploading: Bool { path == nil }

  /// The line the message carries, so the agent knows to open them.
  static func mentions(_ files: [PendingFile]) -> String? {
    let paths = files.compactMap(\.path)
    guard !paths.isEmpty else { return nil }
    let list = paths.map { "@" + $0.replacingOccurrences(of: " ", with: "\\ ") }.joined(separator: " ")
    return "Attached \(paths.count == 1 ? "file" : "files"): \(list)"
  }
}

/// A pending file in the composer: its type icon, name and size, or a spinner while it uploads.
/// Laid out like `PickedElementChip`, so the strip reads as one row of attachments.
public struct PendingFileChip: View {
  @Environment(\.theme) private var theme
  let file: PendingFile

  public init(file: PendingFile) {
    self.file = file
  }

  public var body: some View {
    HStack(spacing: 8) {
      ZStack {
        theme.bgTertiary
        FileTypeIcon(path: file.name, size: 22)
      }
      .frame(width: 44, height: 44)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall - 2))
      VStack(alignment: .leading, spacing: 2) {
        Text(file.name)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.text)
          .lineLimit(1)
          .truncationMode(.middle)
        HStack(spacing: 4) {
          if file.isUploading { ProgressView().controlSize(.mini) }
          Text(file.isUploading ? "Uploading" : ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))
        }
        .font(.scaled(size: 10))
        .foregroundStyle(theme.textMuted)
        .lineLimit(1)
      }
      .frame(maxWidth: 160, alignment: .leading)
    }
    .padding(6)
    .frame(height: 56)
    .background(theme.surface, in: .rect(cornerRadius: theme.radiusSmall))
    .overlay {
      RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border, lineWidth: 1)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(file.isUploading ? "\(file.name), uploading" : "Attached file \(file.name)")
  }
}
