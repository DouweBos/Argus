import ArgusCore
import ArgusUI
import Foundation

/// A compare run's scores and screenshots, kept fresh while a slot still works.
@MainActor @Observable
final class CompareRunModel {
  let groupId: String
  private let store: HostStore
  /// Nil until the first answer; then nil again only when the run is gone.
  private(set) var slots: [CompareSlotScore]?
  private(set) var loaded = false
  private(set) var refreshing = false
  private(set) var screenshots: [String: PlatformImage] = [:]
  private(set) var loadingScreenshots: Set<String> = []
  private(set) var keepingId: String?

  init(groupId: String, store: HostStore) {
    self.groupId = groupId
    self.store = store
  }

  var isWorking: Bool { slots?.contains(where: \.isWorking) ?? false }
  var title: String { CompareGroup(id: groupId, sessions: store.compareSessions(groupId: groupId)).title }

  func load() async {
    let next = await store.loadCompare(groupId: groupId)
    // A dropped poll keeps what's shown; only an answered empty run reads as gone.
    if next != nil || !loaded { slots = next.flatMap { $0.isEmpty ? nil : $0 } }
    loaded = true
  }

  /// Scores, then every screen that's up, as the toolbar's Refresh asks.
  func refresh() async {
    refreshing = true
    await load()
    await loadScreenshots()
    refreshing = false
  }

  func loadScreenshots() async {
    let ids = (slots ?? []).filter(\.hasScreen).map(\.sessionId)
    loadingScreenshots.formUnion(ids)
    let loads = ids.map { id in
      Task { [store] in (id, await store.compareScreenshot(sessionId: id)) }
    }
    for load in loads {
      let (id, data) = await load.value
      if let image = data.flatMap(PlatformImage.init(data:)) { screenshots[id] = image }
      loadingScreenshots.remove(id)
    }
  }

  func runnerName(_ score: CompareSlotScore) -> String { store.compareRunnerName(score.runnerId) }

  func modelName(_ score: CompareSlotScore) -> String? {
    store.compareModelName(runnerId: score.runnerId, model: score.model)
  }

  func reviewComments(_ score: CompareSlotScore) -> Int { store.reviews.comments(score.sessionId).count }

  /// Lands the slot and, when asked, deletes the others; nil when landing failed.
  func keep(_ score: CompareSlotScore, land: CompareLanding, deleteOthers: Bool) async -> HostStore.CompareKept? {
    keepingId = score.sessionId
    defer { keepingId = nil }
    return await store.keepCompare(sessionId: score.sessionId, land: land, deleteOthers: deleteOthers)
  }
}
