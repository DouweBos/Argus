import ArgusCore
import Foundation
import GroveKit
import Observation

/// One session's repository: GroveKit's engine and view models on its worktree,
/// kept current from a file watcher and the host's git broadcasts — agents
/// change worktrees underneath us. The Argus counterpart of Grove's
/// `RepositorySession`.
@MainActor
@Observable
final class GitWorkspace {
  let sessionId: String
  let repoRoot: String
  let isProjectRoot: Bool
  /// On a paired host: git runs there, and its broadcasts stand in for a file watcher.
  let isRemote: Bool
  let repository: GitRepository
  /// One read of branches, tags and remotes per refresh, shared by every view.
  let refs: RepositoryRefs
  let workingCopy: WorkingCopyViewModel
  let history: HistoryViewModel
  let stashes: StashesViewModel
  let reflog: ReflogViewModel
  let branchesReview: BranchesReviewViewModel
  let blame: BlameViewModel
  let undo = GitUndoManager()

  /// The sub-view on screen; a refresh reloads it now and the rest on entry.
  var visible: GitRoute? {
    didSet { if visible != oldValue { Task { await refreshVisibleIfStale() } } }
  }
  /// Why the last host-run git command failed, for the panel's banner.
  var hostError: String?
  /// A host-run command is in flight (fetch, pull, push, checkout, …).
  private(set) var hostBusy: String?
  /// Bumped by every refresh, so a view can key work on it.
  private(set) var generation = 0

  private var filteredHistory: [String: HistoryViewModel] = [:]
  private var filteredHistoryOrder: [String] = []
  private var tabGenerations: [String: Int] = [:]
  private var watcher: FileWatcher?
  private var remoteActive = false
  private var isRefreshing = false
  private var needsAnotherRefresh = false
  private let host: HostStore

  var scope: String { isProjectRoot ? "project" : "session" }

  init(session: RemoteSession, repository: GitRepository, host: HostStore, isRemote: Bool = false) {
    sessionId = session.id
    self.isRemote = isRemote
    repoRoot = session.repoRoot
    isProjectRoot = session.kind == .projectRoot
    self.repository = repository
    self.host = host
    let refs = RepositoryRefs(repository: repository, readsStatus: false)
    self.refs = refs
    workingCopy = WorkingCopyViewModel(repository: repository)
    history = HistoryViewModel(repository: repository, refs: refs)
    stashes = StashesViewModel(repository: repository)
    reflog = ReflogViewModel(repository: repository)
    branchesReview = BranchesReviewViewModel(repository: repository, refs: refs)
    blame = BlameViewModel(repository: repository)
    let refresh: () async -> Void = { [weak self] in await self?.refreshAll() }
    workingCopy.onRepositoryChanged = refresh
    workingCopy.undoManager = undo
    history.onRepositoryChanged = refresh
    history.undoManager = undo
    stashes.onRepositoryChanged = refresh
    reflog.onRepositoryChanged = refresh
    reflog.undoManager = undo
    branchesReview.onRepositoryChanged = refresh
    branchesReview.undoManager = undo
  }

  // MARK: Lifecycle

  /// On screen: watch the worktree (and, for a linked worktree, the shared
  /// git dir its refs live in) and refresh.
  func start() async {
    if isRemote {
      // The worktree is on another disk; the host's broadcasts say when it moved.
      guard !remoteActive else { return }
      remoteActive = true
      return await refreshAll()
    }
    guard watcher == nil else { return }
    var paths = [repository.path.path]
    if let main = WorktreeResolver.mainRepositoryPath(forWorktreeAt: repository.path.path),
      !WorktreeResolver.isSameFolder(main, repository.path.path)
    {
      paths.append((main as NSString).appendingPathComponent(".git"))
    }
    let watcher = FileWatcher(paths: paths, latency: 1.0) { [weak self] in
      Task { @MainActor in await self?.refreshAll() }
    }
    watcher.start()
    self.watcher = watcher
    await refreshAll()
  }

  /// Off screen: stop watching, keep what's loaded.
  func pause() {
    watcher?.stop()
    watcher = nil
    remoteActive = false
  }

  var isActive: Bool { watcher != nil || remoteActive }

  // MARK: Refresh

  /// Reload what reflects repository state. The visible tab reloads now;
  /// hidden history lists are marked stale and reload when shown.
  func refreshAll() async {
    guard !isRefreshing else { return needsAnotherRefresh = true }
    isRefreshing = true
    defer { isRefreshing = false }
    repeat {
      needsAnotherRefresh = false
      generation += 1
      let shown = visibleHistory
      for vm in [history] + Array(filteredHistory.values) where vm !== shown { vm.markStale() }
      let refsRead = refs.beginRefresh()
      async let working: Void = workingCopy.refresh()
      async let list: Void = reload(shown)
      async let tab: Void = refreshVisibleTab()
      _ = await (refsRead.value, working, list, tab)
    } while needsAnotherRefresh
  }

  private func reload(_ vm: HistoryViewModel?) async { await vm?.reload() }

  /// The history list on screen, if any.
  var visibleHistory: HistoryViewModel? {
    guard let visible else { return nil }
    switch visible {
    case .history: return history
    case .branch: return history
    case .branches(let name?), .tags(let name): return name.isEmpty ? history : filteredHistory(for: name)
    case .branches(nil): return history
    default: return nil
    }
  }

  /// A history list filtered to one ref, cached so switching back keeps it.
  func filteredHistory(for ref: String) -> HistoryViewModel {
    if filteredHistoryOrder.last != ref {
      filteredHistoryOrder.removeAll { $0 == ref }
      filteredHistoryOrder.append(ref)
    }
    if let existing = filteredHistory[ref] { return existing }
    let vm = HistoryViewModel(repository: repository, refs: refs)
    vm.filterBranch = ref
    vm.onRepositoryChanged = { [weak self] in await self?.refreshAll() }
    vm.undoManager = undo
    filteredHistory[ref] = vm
    while filteredHistoryOrder.count > 8 {
      filteredHistory[filteredHistoryOrder.removeFirst()] = nil
    }
    return vm
  }

  /// Tab lists (stashes, reflog, branches review, blame) load on entry and
  /// on refresh while shown; stashes also whenever any exist, for the count.
  private func refreshVisibleTab() async {
    if visible != .stashes, !stashes.stashes.isEmpty || tabGenerations["stashes"] == nil {
      await refreshTab("stashes")
    }
    if let key = visibleTabKey { await refreshTab(key) }
  }

  private func refreshVisibleIfStale() async {
    if let history = visibleHistory { await history.loadIfNeeded() }
    guard let key = visibleTabKey, tabGenerations[key] != generation else { return }
    await refreshTab(key)
  }

  private var visibleTabKey: String? {
    switch visible {
    case .stashes: "stashes"
    case .reflog: "reflog"
    case .branchesReview: "branchesReview"
    case .blame: "blame"
    default: nil
    }
  }

  private func refreshTab(_ key: String) async {
    tabGenerations[key] = generation
    switch key {
    case "stashes": await stashes.refresh()
    case "reflog": await reflog.refresh()
    case "branchesReview": await branchesReview.refresh()
    case "blame":
      await blame.reloadFiles()
      if blame.selectedFile != nil { await blame.reload() }
    default: break
    }
  }

  // MARK: Host-run commands

  /// Runs one of the host's typed git commands — the Argus-specific flows
  /// (session branches, protected branches, merging into the base) live
  /// there — then refreshes. Nil and a banner on failure.
  @discardableResult
  func host<C: RemoteCommand>(
    _ command: sending C.Type, _ params: C.Params, label: String, track action: MacTelemetryEvent.GitAction? = nil
  ) async -> C.Result? {
    guard let backend = host.backend else { return nil }
    hostBusy = label
    defer { hostBusy = nil }
    do {
      let result = try await backend.request(command, params)
      hostError = nil
      if let action { track(action, success: true) }
      await refreshAll()
      return result
    } catch {
      hostError = HostStore.describe(error)
      if let action { track(action, success: false) }
      await refreshAll()
      return nil
    }
  }

  /// Runs a GroveKit mutation, reporting its outcome; failures land in `hostError`.
  @discardableResult
  func run(_ action: MacTelemetryEvent.GitAction, label: String, _ work: () async throws -> Void) async -> Bool {
    hostBusy = label
    defer { hostBusy = nil }
    do {
      try await work()
      hostError = nil
      track(action, success: true)
      await refreshAll()
      return true
    } catch {
      hostError = error.localizedDescription
      track(action, success: false)
      await refreshAll()
      return false
    }
  }

  func track(_ action: MacTelemetryEvent.GitAction, success: Bool) {
    MacTelemetry.capture(.gitUsed(action: action, scope: scope, remote: isRemote, success: success))
  }

  func undoLast(redo: Bool) async {
    do {
      if redo { try await undo.redo() } else { try await undo.undo() }
      track(redo ? .redo : .undo, success: true)
    } catch {
      undo.reportError(error, redo: redo)
      track(redo ? .redo : .undo, success: false)
    }
    await refreshAll()
  }
}
