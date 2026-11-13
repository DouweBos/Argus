#if os(macOS)
  import ArgusCore
  import SwiftUI

  /// A compare run's slots in place of the runner, model and effort pills: one pill per
  /// slot to re-pick or remove, a "+" for another, and the ×N that ends the run.
  extension MacChatInputView {
    @ViewBuilder var compareSlotPills: some View {
      compareCountMenu
      ComposerPillDivider()
      ForEach(composer.compareSlots) { slot in
        compareSlotMenu(slot)
      }
      if composer.canAddCompareSlot {
        Button {
          composer.addCompareSlot()
        } label: {
          ComposerPillLabel(icon: Icon.plus, chevron: false)
        }
        .buttonStyle(.argusPlain)
        .fixedSize()
        .help("Add another runner to compare")
        .accessibilityLabel("Add compare slot")
      }
    }

    private var compareCountMenu: some View {
      ChromeMenuButton(edge: .above) {
        ChromeMenuEntry.note("One session per runner, side by side")
        ChromeMenuItem("Use one runner", icon: .symbol(Icon.close)) { composer.endCompare() }
      } label: { open in
        ComposerPillLabel(icon: Icon.compare, title: "×\(composer.compareSlots.count)", accent: true, open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("Comparing \(composer.compareSlots.count) runners")
    }

    private func compareSlotMenu(_ slot: CompareSlot) -> some View {
      ChromeMenuButton(edge: .above) {
        ChromeMenuEntry.header("Runner")
        ChromeMenuItem("Default", subtitle: "Use the computer's default", checked: slot.runnerId == nil) {
          composer.setCompareSlot(slot.id, runnerId: nil)
        }
        for runner in composer.availableRunners {
          ChromeMenuItem(runner.displayName, checked: slot.runnerId == runner.id) {
            guard slot.runnerId != runner.id else { return }
            composer.setCompareSlot(slot.id, runnerId: runner.id)
          }
        }
        let models = composer.compareModels(runnerId: slot.runnerId)
        if !models.isEmpty {
          ChromeMenuEntry.divider
          ChromeMenuEntry.header("Model")
          ChromeMenuItem("Runner's choice", checked: slot.model == nil) {
            composer.setCompareSlot(slot.id, runnerId: slot.runnerId)
          }
          for model in models {
            ChromeMenuItem(model.displayName, subtitle: model.description.isEmpty ? nil : model.description, checked: slot.model == model.value) {
              composer.setCompareSlot(slot.id, runnerId: slot.runnerId, model: model.value)
            }
          }
        }
        ChromeMenuEntry.divider
        ChromeMenuItem("Remove", icon: .symbol(Icon.trash), role: .destructive) { composer.removeCompareSlot(slot.id) }
      } label: { open in
        ComposerPillLabel(icon: Icon.terminal, title: composer.compareSlotLabel(slot), open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("Pick this slot's runner and model")
    }
  }
#endif
