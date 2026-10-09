import Foundation

/// The worktree's file list as a tree: folders first, then files, each by name.
struct CodeTreeNode: Identifiable, Hashable {
  let name: String
  /// Worktree-relative; a folder's has no trailing slash.
  let path: String
  /// Nil for a file.
  var children: [CodeTreeNode]?

  var id: String { path }
  var isFolder: Bool { children != nil }

  static func tree(_ paths: [String]) -> [CodeTreeNode] {
    final class Folder {
      var folders: [String: Folder] = [:]
      var files: [String] = []
    }
    let root = Folder()
    for path in paths {
      var folder = root
      let parts = path.split(separator: "/")
      for part in parts.dropLast() {
        let name = String(part)
        if let next = folder.folders[name] {
          folder = next
        } else {
          let next = Folder()
          folder.folders[name] = next
          folder = next
        }
      }
      if let file = parts.last { folder.files.append(String(file)) }
    }
    func nodes(_ folder: Folder, prefix: String) -> [CodeTreeNode] {
      let order: (String, String) -> Bool = { $0.localizedStandardCompare($1) == .orderedAscending }
      let folders = folder.folders.sorted { order($0.key, $1.key) }.map { name, child in
        CodeTreeNode(name: name, path: prefix + name, children: nodes(child, prefix: prefix + name + "/"))
      }
      let files = folder.files.sorted(by: order).map { CodeTreeNode(name: $0, path: prefix + $0, children: nil) }
      return folders + files
    }
    return nodes(root, prefix: "")
  }
}
