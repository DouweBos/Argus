import GroveKit

/// Which Changes rows the view model has selected, as list ids, so GroveKit
/// stays the one owner of the selection and the rows only draw it.
@MainActor
struct ChangeSelection {
  let selectedIDs: Set<String>

  init(vm: WorkingCopyViewModel, items: [ChangeItem]) {
    var selected: Set<String> = []
    for item in items {
      guard case .file(let entry, let section, _) = item.kind else { continue }
      if vm.isSelected(entry, side: section.side) { selected.insert(item.id) }
    }
    selectedIDs = selected
  }
}
