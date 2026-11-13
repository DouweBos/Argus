import ArgusUI
import SwiftUI

/// A compare run's slots one under another, scored by the computer: what each
/// changed, how its runs and tests stand, what it cost and what its screen shows.
/// "Keep this one" lands the winner and deletes the rest.
struct CompareRunScreen: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush
  @Environment(\.openURL) private var openURL

  let groupId: String

  @State private var scores: [CompareSlotScore]?
  @State private var screenshots: [String: UIImage] = [:]
  @State private var loadingScreens: Set<String> = []
  @State private var keeping: CompareSlotScore?
  @State private var keepingId: String?

  private var title: String {
    let sessions = host.compareSessions(groupId: groupId)
    return sessions.isEmpty ? "Compare" : CompareGroup(id: groupId, sessions: sessions).title
  }

  private var anyWorking: Bool { scores?.contains(where: \.isWorking) ?? true }

  var body: some View {
    Screen {
      if let scores {
        if scores.isEmpty {
          EmptyState(
            icon: Icon.compare, title: "Compare run gone",
            body: "Its slots were kept or deleted on the computer."
          ) {}
        } else {
          ForEach(scores) { card($0) }
        }
      } else {
        Loading(label: "Scoring the runs…")
      }
    }
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await loadSessionsIfNeeded()
      await load(screens: true)
    }
    .refreshable { await load(screens: true) }
    // A settled run's numbers stop moving, so only a working one is asked again.
    .liveRefresh(enabled: host.connection == .ready && anyWorking, every: .seconds(5)) {
      await load(screens: false)
    }
    .sheet(item: $keeping) { score in
      CompareKeepSheet(
        runner: host.compareRunnerName(score.runnerId), others: max((scores?.count ?? 1) - 1, 0),
        busy: keepingId == score.sessionId
      ) { landing, deleteOthers in
        await keep(score, landing: landing, deleteOthers: deleteOthers)
      }
    }
  }

  private func card(_ score: CompareSlotScore) -> some View {
    CompareSlotCard(
      score: score, runner: host.compareRunnerName(score.runnerId),
      model: host.compareModelName(runnerId: score.runnerId, model: score.model),
      reviewComments: host.reviews.comments(score.sessionId).count,
      screenshot: screenshots[score.sessionId], loadingScreenshot: loadingScreens.contains(score.sessionId),
      keeping: keepingId == score.sessionId,
      onOpen: { open(score.sessionId) },
      onKeep: host.hasControl ? { keeping = score } : nil)
  }

  private func route(_ sessionId: String) -> Route? {
    guard let session = host.session(id: sessionId) else { return nil }
    return .session(id: session.id, label: SessionActivity.title(session), repoRoot: session.repoRoot)
  }

  private func open(_ sessionId: String) {
    guard let route = route(sessionId) else { return }
    (stackPush ?? router.push)(route)
  }

  private func load(screens: Bool) async {
    guard let loaded = await host.loadCompare(groupId: groupId) else {
      if scores == nil { scores = [] }
      return
    }
    scores = loaded
    // Screens change while an agent works; a finished slot's is read once.
    let wanted = loaded.filter { $0.hasScreen && (screens || $0.isWorking || screenshots[$0.sessionId] == nil) }
    await withTaskGroup(of: (String, Data?).self) { group in
      for score in wanted {
        loadingScreens.insert(score.sessionId)
        group.addTask { await (score.sessionId, host.compareScreenshot(sessionId: score.sessionId)) }
      }
      for await (id, data) in group {
        loadingScreens.remove(id)
        if let image = data.flatMap(UIImage.init(data:)) { screenshots[id] = image }
      }
    }
  }

  /// A deep link can arrive before any list holds the run's sessions.
  private func loadSessionsIfNeeded() async {
    guard host.compareSessions(groupId: groupId).isEmpty else { return }
    for project in host.projects where host.sessionsByRepo[project.repoRoot] == nil {
      await host.loadSessions(repoRoot: project.repoRoot)
    }
  }

  private func keep(_ score: CompareSlotScore, landing: CompareLanding, deleteOthers: Bool) async {
    keepingId = score.sessionId
    defer { keepingId = nil }
    guard let kept = await host.keepCompare(sessionId: score.sessionId, land: landing, deleteOthers: deleteOthers)
    else { return }
    keeping = nil
    if let route = route(score.sessionId) {
      // Back skips a run that is gone.
      if deleteOthers { router.replaceTop(with: route, dropping: 1) } else { (stackPush ?? router.push)(route) }
    }
    if let url = kept.pullRequestUrl.flatMap(URL.init(string:)) { openURL(url) }
  }
}

/// How a kept slot lands, the Mac's keep sheet on a phone.
private struct CompareKeepSheet: View {
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let runner: String
  let others: Int
  let busy: Bool
  let confirm: (CompareLanding, Bool) async -> Void

  @State private var landing: CompareLanding = .merge
  @State private var deleteOthers = true

  var body: some View {
    NavigationStack {
      ScrollView {
        CompareKeepForm(landing: $landing, deleteOthers: $deleteOthers, runner: runner, others: others)
          .padding(theme.space)
      }
      .background(theme.bg.ignoresSafeArea())
      .navigationTitle("Keep this one")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Keep") { Task { await confirm(landing, deleteOthers) } }
          }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .interactiveDismissDisabled(busy)
  }
}
