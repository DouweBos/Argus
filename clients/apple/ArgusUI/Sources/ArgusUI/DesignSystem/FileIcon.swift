import Foundation

/// Picks a Material Icon Theme icon for a path the way VS Code does: exact
/// file name, then each dotted suffix longest first (`test.tsx` before `tsx`),
/// then the generic file. Folders go by name, `-open` when expanded.
/// The tables are filtered from the theme's manifest by `scripts/gen-file-icons.ts`.
public enum FileIcon {
  public static let file = "file"
  public static let folder = "folder"

  struct Lookup: Decodable, Sendable {
    var fileNames: [String: String] = [:]
    var fileExtensions: [String: String] = [:]
    var folderNames: [String: String] = [:]
    var folderExtensions: [String: String] = [:]
  }

  static let bundle = Bundle.module

  static let lookup: Lookup = {
    guard let url = bundle.url(forResource: "FileIcons", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let lookup = try? JSONDecoder().decode(Lookup.self, from: data)
    else { return Lookup() }
    return lookup
  }()

  /// The asset name for `path`; its last component decides, case-insensitively.
  public static func name(forPath path: String, isDirectory: Bool = false, isExpanded: Bool = false) -> String {
    name(forPath: path, isDirectory: isDirectory, isExpanded: isExpanded, in: lookup)
  }

  static func name(forPath path: String, isDirectory: Bool, isExpanded: Bool, in lookup: Lookup) -> String {
    let base = lastComponent(path).lowercased()
    if isDirectory {
      let icon =
        lookup.folderNames[base]
        ?? suffixes(base).lazy.compactMap { lookup.folderExtensions[$0] }.first
        ?? folder
      return isExpanded ? "\(icon)-open" : icon
    }
    if let icon = lookup.fileNames[base] { return icon }
    return suffixes(base).lazy.compactMap { lookup.fileExtensions[$0] }.first ?? file
  }

  /// Every asset the resolver can return.
  public static var allNames: [String] {
    let files = Set(lookup.fileNames.values).union(lookup.fileExtensions.values).union([file])
    let folders = Set(lookup.folderNames.values).union(lookup.folderExtensions.values).union([folder])
    return files.sorted() + folders.sorted().flatMap { [$0, "\($0)-open"] }
  }

  /// `a.test.tsx` → `["test.tsx", "tsx"]`; a dotfile's own name counts (`.env` → `["env"]`).
  static func suffixes(_ name: String) -> [String] {
    var out: [String] = []
    var rest = Substring(name)
    while let dot = rest.firstIndex(of: ".") {
      rest = rest[rest.index(after: dot)...]
      if !rest.isEmpty { out.append(String(rest)) }
    }
    return out
  }

  private static func lastComponent(_ path: String) -> Substring {
    path.split(separator: "/").last ?? Substring(path)
  }
}
