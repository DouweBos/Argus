#if DEBUG
  import GroveKit

  /// What a Changes row's menu offers for patches and Git LFS, titled as GroveUIKit's menu, for the dev
  /// driver, which can't open a context menu.
  @MainActor
  enum ChangeMenuItems {
    struct Item {
      let title: String
      let run: @MainActor () -> Void
    }

    static func items(workspace: GitWorkspace, entry: StatusEntry, side: DiffSide) -> [Item] {
      let vm = workspace.workingCopy
      let entries = vm.actionEntries(for: entry, side: side)
      var items: [Item] = []
      if workspace.features.contains(.export) {
        let patchEntries = vm.patchEntries(for: entry, side: side)
        items.append(
          Item(title: patchEntries.count > 1 ? "Create Patch from \(patchEntries.count) Files" : "Create Patch") {
            Task { await createPatch(workspace: workspace, entries: patchEntries, side: side) }
          })
      }
      let candidates = vm.lfsCandidates(entries)
      if !candidates.isEmpty, !vm.lfs.status.isMissing {
        let track = { (byExtension: Bool) in
          Task {
            vm.clearError()
            await vm.trackWithLFS(candidates, byExtension: byExtension)
          }
        }
        let files = candidates.count > 1 ? "These \(candidates.count) Files" : "This File"
        items.append(Item(title: "Track with Git LFS › \(files)") { _ = track(false) })
        if let pattern = WorkingCopyViewModel.lfsExtensionPattern(for: candidates) {
          items.append(Item(title: "Track with Git LFS › All \(pattern) Files") { _ = track(true) })
        }
      }
      return items
    }

    private static func createPatch(workspace: GitWorkspace, entries: [StatusEntry], side: DiffSide) async {
      let vm = workspace.workingCopy
      guard let url = await PatchPanels.chooseDestination(name: vm.suggestedPatchName(for: entries), message: "")
      else { return }
      vm.clearError()
      await vm.createPatch(from: entries, side: side, to: url)
      workspace.track(.patchCreate, success: vm.errorMessage == nil)
    }
  }
#endif
