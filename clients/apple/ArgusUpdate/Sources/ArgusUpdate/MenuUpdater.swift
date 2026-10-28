import Foundation
import Observation
@preconcurrency import Sparkle

/// Sparkle driven from a menu: no update windows, just `state` for the menu to
/// render and `check`/`download`/`install` for its items. Downloads only start
/// when asked, and nothing installs until `install` passes the agents guard.
@MainActor
@Observable
public final class MenuUpdater {
  public private(set) var state: UpdateState
  /// What happened, for telemetry; never versions or URLs.
  @ObservationIgnored public var onEvent: (@MainActor (Event) -> Void)?

  public enum Event: Sendable {
    case checked(found: Bool)
    case downloaded
    case installing
    case failed
  }

  @ObservationIgnored private var updater: SPUUpdater?
  @ObservationIgnored private let driver = Driver()
  @ObservationIgnored private let feedDelegate: FeedDelegate

  /// `bundle` must carry `SUPublicEDKey`; without one the updater stays `unavailable`.
  public init(feed: UpdateFeed, bundle: Bundle = .main) {
    feedDelegate = FeedDelegate(feed: feed)
    state = UpdateSupport.isConfigured(bundle) ? .idle : .unavailable
    guard state != .unavailable else { return }
    driver.owner = self
    let updater = SPUUpdater(
      hostBundle: bundle, applicationBundle: bundle, userDriver: driver, delegate: feedDelegate)
    // Hourly background checks, never a download nobody asked for.
    updater.automaticallyChecksForUpdates = true
    updater.automaticallyDownloadsUpdates = false
    updater.updateCheckInterval = 3600
    do {
      try updater.start()
      self.updater = updater
    } catch {
      state = .failed(error.localizedDescription)
    }
  }

  /// A new channel takes effect on the next check.
  public var feed: UpdateFeed {
    get { feedDelegate.feed }
    set { feedDelegate.feed = newValue }
  }

  public func check() {
    guard let updater, updater.canCheckForUpdates else { return }
    updater.checkForUpdates()
  }

  /// Start downloading the update `available` names.
  public func download() {
    guard case .available = state, let reply = driver.foundReply else { return }
    driver.foundReply = nil
    state = .downloading(percent: 0)
    reply(.install)
  }

  /// Restart into the downloaded update, unless an agent is mid-run.
  @discardableResult
  public func install(activeAgents: Int) -> InstallVerdict {
    let verdict = InstallVerdict(state: state, activeAgents: activeAgents)
    guard verdict == .ok, let reply = driver.readyReply else { return verdict }
    driver.readyReply = nil
    state = .installing
    onEvent?(.installing)
    reply(.install)
    return verdict
  }

  fileprivate func set(_ next: UpdateState) {
    state = next
  }

  fileprivate func emit(_ event: Event) {
    onEvent?(event)
  }
}

/// Whether this build can take updates at all.
public enum UpdateSupport {
  public static func isConfigured(_ bundle: Bundle) -> Bool {
    let key = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String
    return !(key ?? "").trimmingCharacters(in: .whitespaces).isEmpty
  }
}

final class FeedDelegate: NSObject, SPUUpdaterDelegate, @unchecked Sendable {
  var feed: UpdateFeed

  init(feed: UpdateFeed) {
    self.feed = feed
  }

  func feedURLString(for updater: SPUUpdater) -> String? {
    feed.url.absoluteString
  }
}

/// Sparkle's user driver, turned into `MenuUpdater.state`. Replies are kept
/// until the menu acts on them.
@MainActor
private final class Driver: NSObject, SPUUserDriver {
  weak var owner: MenuUpdater?
  var foundReply: ((SPUUserUpdateChoice) -> Void)?
  var readyReply: ((SPUUserUpdateChoice) -> Void)?
  private var expected: UInt64 = 0
  private var received: UInt64 = 0
  private var version = ""

  func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
    reply(SUUpdatePermissionResponse(automaticUpdateChecks: true, sendSystemProfile: false))
  }

  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
    owner?.set(.checking)
  }

  func showUpdateFound(
    with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void
  ) {
    version = appcastItem.displayVersionString
    owner?.emit(.checked(found: true))
    if state.stage == .notDownloaded {
      foundReply = reply
      owner?.set(.available(version: version))
    } else {
      // Already downloaded on an earlier check: carry on to the ready step.
      reply(.install)
    }
  }

  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}

  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: any Error) {}

  func showUpdateNotFoundWithError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    owner?.set(.upToDate)
    owner?.emit(.checked(found: false))
    acknowledgement()
  }

  func showUpdaterError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    owner?.set(.failed(Self.shorten(error.localizedDescription)))
    owner?.emit(.failed)
    acknowledgement()
  }

  func showDownloadInitiated(cancellation: @escaping () -> Void) {
    expected = 0
    received = 0
    owner?.set(.downloading(percent: 0))
  }

  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    expected = expectedContentLength
  }

  func showDownloadDidReceiveData(ofLength length: UInt64) {
    received += length
    guard expected > 0 else { return }
    owner?.set(.downloading(percent: min(100, Int(received * 100 / expected))))
  }

  func showDownloadDidStartExtractingUpdate() {
    owner?.set(.downloading(percent: 100))
  }

  func showExtractionReceivedProgress(_ progress: Double) {}

  func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
    readyReply = reply
    owner?.set(.ready(version: version))
    owner?.emit(.downloaded)
  }

  func showInstallingUpdate(
    withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void
  ) {
    owner?.set(.installing)
  }

  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
    owner?.set(.idle)
    acknowledgement()
  }

  func showUpdateInFocus() {}

  func dismissUpdateInstallation() {
    foundReply = nil
    readyReply = nil
    // The end of every cycle: keep an answer the menu should still show.
    switch owner?.state {
    case .upToDate?, .failed?, .unavailable?: break
    default: owner?.set(.idle)
    }
  }

  /// Sparkle's errors run to several sentences; a menu line takes the first.
  static func shorten(_ message: String) -> String {
    let first = message.split(separator: "\n").first.map(String.init) ?? message
    return first.count > 80 ? String(first.prefix(79)) + "…" : first
  }
}
