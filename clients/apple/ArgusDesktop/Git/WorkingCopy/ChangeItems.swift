import GroveKit

/// The three groups of the Changes list.
enum ChangeSection: String {
  case conflicted = "Conflicted"
  case staged = "Staged"
  case unstaged = "Unstaged"

  var side: DiffSide { self == .staged ? .staged : .unstaged }
}

/// One row of the Changes list, flattened so a single lazy `List` holds
/// every section, directory header and file.
struct ChangeItem: Identifiable {
  enum Kind {
    case header(ChangeSection, count: Int)
    case directory(String, ChangeSection)
    case file(StatusEntry, ChangeSection, showsDirectory: Bool)
  }

  let id: String
  let kind: Kind

  static func header(_ section: ChangeSection, count: Int) -> ChangeItem {
    ChangeItem(id: "h:\(section.rawValue)", kind: .header(section, count: count))
  }

  static func directory(_ dir: String, _ section: ChangeSection) -> ChangeItem {
    ChangeItem(id: "d:\(section.rawValue):\(dir)", kind: .directory(dir, section))
  }

  @MainActor
  static func file(_ entry: StatusEntry, _ section: ChangeSection, showsDirectory: Bool) -> ChangeItem {
    ChangeItem(id: fileID(entry.path, section), kind: .file(entry, section, showsDirectory: showsDirectory))
  }

  static func fileID(_ path: String, _ section: ChangeSection) -> String { "f:\(section.rawValue):\(path)" }

  /// Every row, grouped as the view model orders them; `filter` matches paths case-insensitively.
  @MainActor
  static func build(_ vm: WorkingCopyViewModel, filter: String) -> [ChangeItem] {
    let query = filter.trimmingCharacters(in: .whitespaces)
    func matching(_ entries: [StatusEntry]) -> [StatusEntry] {
      query.isEmpty ? entries : entries.filter { $0.path.localizedCaseInsensitiveContains(query) }
    }
    var items: [ChangeItem] = []
    let groups: [(ChangeSection, [StatusEntry])] = [
      (.conflicted, vm.conflictedFiles), (.staged, vm.stagedFiles), (.unstaged, vm.unstagedFiles),
    ]
    for (section, all) in groups {
      let entries = matching(all)
      guard !entries.isEmpty else { continue }
      items.append(.header(section, count: entries.count))
      if vm.fileViewMode == .treeModified {
        for group in vm.directoryGroups(entries) {
          if !group.directory.isEmpty { items.append(.directory(group.directory, section)) }
          items += group.entries.map { .file($0, section, showsDirectory: false) }
        }
      } else {
        items += entries.map { .file($0, section, showsDirectory: true) }
      }
    }
    return items
  }
}
