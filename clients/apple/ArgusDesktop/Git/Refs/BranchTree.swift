import GroveKit

/// Local branches as folders split on `/`, as Electron's `buildLocalTree`.
@MainActor
struct BranchTreeNode: Identifiable {
  /// The folder path (`feature/ui`) or the branch's full name.
  let id: String
  let title: String
  let branch: BranchInfo?
  var children: [BranchTreeNode]

  var isFolder: Bool { branch.map { _ in false } ?? true }

  static func build(_ branches: [BranchInfo]) -> [BranchTreeNode] {
    var root = BranchTreeNode(id: "", title: "", branch: nil, children: [])
    for branch in branches {
      root.insert(branch, parts: branch.name.split(separator: "/").map(String.init)[...], prefix: "")
    }
    return root.sorted().children
  }

  private mutating func insert(_ branch: BranchInfo, parts: ArraySlice<String>, prefix: String) {
    guard let first = parts.first else { return }
    let path = prefix.isEmpty ? first : "\(prefix)/\(first)"
    if parts.count == 1 {
      children.append(BranchTreeNode(id: branch.name, title: first, branch: branch, children: []))
      return
    }
    let index =
      children.firstIndex { $0.isFolder && $0.id == path }
      ?? {
        children.append(BranchTreeNode(id: path, title: first, branch: nil, children: []))
        return children.count - 1
      }()
    children[index].insert(branch, parts: parts.dropFirst(), prefix: path)
  }

  /// Folders first, then branches, each by name.
  private func sorted() -> BranchTreeNode {
    var copy = self
    copy.children = children.map { $0.sorted() }.sorted { lhs, rhs in
      if lhs.isFolder != rhs.isFolder { return lhs.isFolder }
      return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
    }
    return copy
  }

  /// Folder paths above `name`, so the checked-out branch starts revealed.
  static func ancestors(of name: String) -> [String] {
    let parts = name.split(separator: "/").map(String.init)
    return parts.indices.dropLast().map { parts[...$0].joined(separator: "/") }
  }
}
