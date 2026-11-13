#if os(iOS)
  import ArgusCore
  import ArgusKit
  import SwiftUI

  /// A compare run's slots under the phone start composer, one row each: what it runs on,
  /// a menu to pick another runner or model, and a remove. "Add runner" while there's room.
  struct PhoneCompareSlots: View {
    @Environment(\.theme) private var theme
    let composer: ComposerModel

    var body: some View {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 6) {
          Image(systemName: Icon.compare).font(.scaled(size: 11, weight: .semibold))
          Text("Compare on \(composer.compareSlots.count) runners").font(.scaled(.caption).weight(.semibold))
          Spacer(minLength: 4)
          Button("Stop comparing") { composer.endCompare() }
            .font(.scaled(.caption))
            .buttonStyle(.argusPlain)
            .foregroundStyle(theme.accent)
        }
        .foregroundStyle(theme.textSecondary)
        .padding(.vertical, 6)
        ForEach(Array(composer.compareSlots.enumerated()), id: \.element.id) { index, slot in
          row(slot, number: index + 1)
        }
        if composer.canAddCompareSlot {
          Button { composer.addCompareSlot() } label: {
            Label("Add runner", systemImage: Icon.plus).font(.scaled(.subheadline))
              .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
              .contentShape(Rectangle())
          }
          .buttonStyle(.argusPlain)
          .foregroundStyle(theme.accent)
        }
      }
    }

    private func row(_ slot: CompareSlot, number: Int) -> some View {
      HStack(spacing: 8) {
        Menu {
          runnerChoices(slot)
        } label: {
          HStack(spacing: 8) {
            Text("\(number)").font(.scaled(.caption).monospacedDigit()).foregroundStyle(theme.textMuted).frame(width: 14)
            Text(composer.compareSlotLabel(slot)).font(.scaled(.subheadline)).foregroundStyle(theme.text).lineLimit(1)
            Image(systemName: "chevron.up.chevron.down").font(.scaled(size: 10)).foregroundStyle(theme.textMuted)
            Spacer(minLength: 0)
          }
          .frame(minHeight: 36)
          .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .accessibilityLabel("Slot \(number): \(composer.compareSlotLabel(slot))")
        Button { composer.removeCompareSlot(slot.id) } label: {
          Image(systemName: Icon.close).font(.scaled(size: 12, weight: .semibold)).foregroundStyle(theme.textMuted)
            .frame(width: 32, height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.argusPlain)
        .accessibilityLabel("Remove slot \(number)")
      }
    }

    /// Each runner, its models a level down when it has any.
    @ViewBuilder
    private func runnerChoices(_ slot: CompareSlot) -> some View {
      ForEach(composer.availableRunners, id: \.id) { runner in
        let models = composer.compareModels(runnerId: runner.id)
        let current = slot.runnerId == runner.id
        if models.isEmpty {
          Button { composer.setCompareSlot(slot.id, runnerId: runner.id) } label: {
            choice(runner.displayName, checked: current)
          }
        } else {
          Menu {
            Button { composer.setCompareSlot(slot.id, runnerId: runner.id) } label: {
              choice("Runner's choice", checked: current && slot.model == nil)
            }
            ForEach(models, id: \.value) { model in
              Button { composer.setCompareSlot(slot.id, runnerId: runner.id, model: model.value) } label: {
                choice(model.displayName, checked: current && slot.model == model.value)
              }
            }
          } label: {
            choice(runner.displayName, checked: current)
          }
        }
      }
    }

    @ViewBuilder
    private func choice(_ title: String, checked: Bool) -> some View {
      if checked { Label(title, systemImage: Icon.check) } else { Text(title) }
    }
  }
#endif
