import Foundation
import Observation
@preconcurrency import Sparkle

/// Sparkle with its own windows, for an app that has them: the Mac app's
/// **Check for Updates…**. Quitting to install goes through the app's normal
/// quit, so its running-agents prompt still applies.
@MainActor
@Observable
public final class StandardUpdater {
  public private(set) var canCheck = false
  public let isConfigured: Bool
  @ObservationIgnored private var controller: SPUStandardUpdaterController?
  @ObservationIgnored private let feedDelegate: FeedDelegate
  @ObservationIgnored private var observation: NSKeyValueObservation?

  public init(feed: UpdateFeed, bundle: Bundle = .main) {
    feedDelegate = FeedDelegate(feed: feed)
    isConfigured = UpdateSupport.isConfigured(bundle)
    guard isConfigured else { return }
    let controller = SPUStandardUpdaterController(
      startingUpdater: true, updaterDelegate: feedDelegate, userDriverDelegate: nil)
    self.controller = controller
    canCheck = controller.updater.canCheckForUpdates
    observation = controller.updater.observe(\.canCheckForUpdates, options: [.new]) { [weak self] updater, _ in
      Task { @MainActor in self?.canCheck = updater.canCheckForUpdates }
    }
  }

  public var feed: UpdateFeed {
    get { feedDelegate.feed }
    set { feedDelegate.feed = newValue }
  }

  public func check() {
    controller?.checkForUpdates(nil)
  }
}
