import AppKit
import GroveKit

/// Translates the native `List` selection into the view model's Finder-style
/// click and move calls, so GroveKit stays the one owner of the selection.
@MainActor
struct ChangeSelection {
  let vm: WorkingCopyViewModel
  let files: [String: (entry: StatusEntry, side: DiffSide)]
  /// File ids top to bottom, for telling which end of a Shift range moved.
  let order: [String]

  init(vm: WorkingCopyViewModel, items: [ChangeItem]) {
    self.vm = vm
    var files: [String: (StatusEntry, DiffSide)] = [:]
    var order: [String] = []
    for item in items {
      guard case .file(let entry, let section, _) = item.kind else { continue }
      files[item.id] = (entry, section.side)
      order.append(item.id)
    }
    self.files = files
    self.order = order
  }

  var selectedIDs: Set<String> {
    Set(order.filter { id in files[id].map { vm.isSelected($0.entry, side: $0.side) } ?? false })
  }

  func apply(_ next: Set<String>) async {
    let next = next.filter { files[$0] != nil }
    let old = selectedIDs
    guard next != old, !next.isEmpty else { return }
    let event = NSApp.currentEvent
    let flags = event?.modifierFlags ?? []
    if event?.type == .keyDown, let offset = Self.arrowOffset(event?.keyCode) {
      return await vm.moveSelection(by: offset, extend: flags.contains(.shift))
    }
    let target: String?
    if flags.contains(.command) {
      target = next.symmetricDifference(old).first
    } else if flags.contains(.shift) {
      target = movedEnd(of: next, from: old)
    } else {
      target = next.count == 1 ? next.first : next.subtracting(old).first ?? next.first
    }
    guard let target, let file = files[target] else { return }
    await vm.click(
      file.entry, side: file.side, extend: flags.contains(.shift) && !flags.contains(.command),
      toggle: flags.contains(.command))
  }

  /// The end of the new range that wasn't an end before; the other is the anchor.
  private func movedEnd(of next: Set<String>, from old: Set<String>) -> String? {
    func ends(_ set: Set<String>) -> [String] {
      let listed = order.filter(set.contains)
      return [listed.first, listed.last].compactMap { $0 }
    }
    let previous = Set(ends(old))
    let current = ends(next)
    return current.last { !previous.contains($0) } ?? current.last
  }

  private static func arrowOffset(_ keyCode: UInt16?) -> Int? {
    switch keyCode {
    case 125: 1
    case 126: -1
    default: nil
    }
  }
}
