import Foundation

/// Where a dragged deep link lands: before an entry, or at the end of a
/// folder (`nil` folder is the top level).
public enum DeeplinkDrop: Equatable, Sendable {
  case before(UUID)
  case append(to: UUID?)
}

extension [ArgusConfigDraft.Deeplink] {
  /// Moves an entry anywhere in the tree, as the desktop editor's drag does.
  /// A folder can't be dropped into itself or its own descendants.
  public mutating func moveDeeplink(_ id: UUID, to drop: DeeplinkDrop) {
    guard drop != .before(id), let entry = Self.find(id, in: self) else { return }
    switch drop {
    case .before(let target) where Self.find(target, in: [entry]) != nil: return
    case .append(let folder?) where Self.find(folder, in: [entry]) != nil: return
    default: break
    }
    _ = Self.remove(id, from: &self)
    switch drop {
    case .before(let target): _ = Self.insert(entry, before: target, in: &self)
    case .append(nil): append(entry)
    case .append(let folder?): _ = Self.append(entry, to: folder, in: &self)
    }
  }

  private static func find(_ id: UUID, in list: Self) -> Element? {
    for item in list {
      if item.id == id { return item }
      if let hit = find(id, in: item.children ?? []) { return hit }
    }
    return nil
  }

  private static func remove(_ id: UUID, from list: inout Self) -> Bool {
    if let index = list.firstIndex(where: { $0.id == id }) {
      list.remove(at: index)
      return true
    }
    for index in list.indices where list[index].children != nil {
      if remove(id, from: &list[index].children!) { return true }
    }
    return false
  }

  private static func insert(_ entry: Element, before target: UUID, in list: inout Self) -> Bool {
    if let index = list.firstIndex(where: { $0.id == target }) {
      list.insert(entry, at: index)
      return true
    }
    for index in list.indices where list[index].children != nil {
      if insert(entry, before: target, in: &list[index].children!) { return true }
    }
    return false
  }

  private static func append(_ entry: Element, to folder: UUID, in list: inout Self) -> Bool {
    for index in list.indices {
      if list[index].id == folder, list[index].children != nil {
        list[index].children!.append(entry)
        return true
      }
      if list[index].children != nil, append(entry, to: folder, in: &list[index].children!) { return true }
    }
    return false
  }
}
