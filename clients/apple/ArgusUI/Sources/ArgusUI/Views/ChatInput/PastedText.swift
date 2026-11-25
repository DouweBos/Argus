import Foundation

/// The text a paste carries next to its images.
enum PastedText {
  /// `text` to insert beside pasted images, or nil when it only names them:
  /// a copied file's name or path, or a browser's image URL.
  static func besideImages(_ text: String?, naming names: [String]) -> String? {
    guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    let names = Set(names.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })
    let lines = text.split(whereSeparator: \.isNewline)
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    return lines.allSatisfy(names.contains) ? nil : text
  }
}
