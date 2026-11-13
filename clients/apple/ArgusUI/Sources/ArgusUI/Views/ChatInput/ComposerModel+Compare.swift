import ArgusCore
import ArgusKit
import Foundation

/// A new worktree's start fanned out over 2–5 runner/model slots, one session each.
extension ComposerModel {
  public var offersCompare: Bool { starter?.offersCompare == true && host.runners.count > 0 }

  /// The send starts a compare run rather than one agent.
  public var isComparing: Bool { offersCompare && compareSlots.count >= CompareSlot.minimum }

  public var canAddCompareSlot: Bool { compareSlots.count < CompareSlot.maximum }

  /// Starts with the runner picked now plus the next available one, so ×2 compares something.
  public func beginCompare() {
    guard compareSlots.isEmpty else { return }
    let first = CompareSlot(runnerId: runner?.id, model: draftModel, effort: draftEffort)
    let other = availableRunners.first { $0.id != (runner?.id ?? defaultRunnerId) }
    compareSlots = [first, CompareSlot(runnerId: other?.id ?? runner?.id)]
  }

  public func endCompare() { compareSlots = [] }

  /// Another slot on a runner not in the run yet, else the last slot's.
  public func addCompareSlot() {
    guard canAddCompareSlot else { return }
    let used = Set(compareSlots.map { $0.runnerId ?? defaultRunnerId })
    let next = availableRunners.first { !used.contains($0.id) }?.id ?? compareSlots.last?.runnerId
    compareSlots.append(CompareSlot(runnerId: next))
  }

  /// Below two slots it's a single start again.
  public func removeCompareSlot(_ id: UUID) {
    compareSlots.removeAll { $0.id == id }
    if compareSlots.count < CompareSlot.minimum { compareSlots = [] }
  }

  /// A runner switch drops the slot's model and effort: ids don't carry across runners.
  public func setCompareSlot(_ id: UUID, runnerId: String?, model: String? = nil) {
    guard let index = compareSlots.firstIndex(where: { $0.id == id }) else { return }
    compareSlots[index].runnerId = runnerId
    compareSlots[index].model = model
    compareSlots[index].effort = nil
  }

  /// The models a slot's runner offers: declared ones, else what it last reported.
  public func compareModels(runnerId: String?) -> [RemoteModelInfo] {
    if let declared = host.runners.first(where: { $0.id == runnerId })?.models, !declared.isEmpty {
      return declared.map {
        RemoteModelInfo(value: $0.value, displayName: $0.displayName, description: $0.description ?? "")
      }
    }
    return host.lastKnownModels(runnerId: runnerId)
  }

  /// "Codex · GPT-5", or the runner alone when it picks its own model.
  public func compareSlotLabel(_ slot: CompareSlot) -> String {
    let runner = host.runners.first { $0.id == slot.runnerId }?.displayName ?? "Default runner"
    guard let model = slot.model else { return runner }
    return "\(runner) · \(ModelName.label(for: model, in: compareModels(runnerId: slot.runnerId)) ?? model)"
  }

  public var availableRunners: [RemoteRunner] { host.runners.filter(\.isAvailable) }

  private var defaultRunnerId: String { "" }
}
