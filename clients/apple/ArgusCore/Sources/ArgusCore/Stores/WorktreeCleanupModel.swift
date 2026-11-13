import ArgusKit
import Foundation
import Observation

/// The worktree cleanup policy and its dry run, for Settings on the Mac and the phone.
@MainActor
@Observable
public final class WorktreeCleanupModel {
  public typealias Entry = ArgusProtocol.WorktreeCleanupEntry
  public typealias Policy = ArgusProtocol.WorktreeCleanupPolicy

  public private(set) var preview: ArgusProtocol.WorktreeCleanupPreview?
  public private(set) var loading = false
  public private(set) var cleaning = false
  public private(set) var error: String?
  @ObservationIgnored private let backend: @MainActor () -> (any HostBackend)?

  public init(host: HostStore) {
    backend = { [weak host] in host?.backend }
  }

  public var policy: Policy? { preview?.policy }
  public var removable: [Entry] { preview?.entries.filter { $0.blockedBy == nil } ?? [] }
  public var kept: [Entry] { preview?.entries.filter { $0.blockedBy != nil } ?? [] }
  public var reclaimableBytes: Double { removable.reduce(0) { $0 + ($1.bytes ?? 0) } }

  public func load() async {
    guard let backend = backend() else { return }
    loading = true
    defer { loading = false }
    do {
      preview = try await backend.request(ArgusProtocol.Methods.WorktreesCleanupPreview.self, .init())
      error = nil
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  /// Saves the policy, then re-runs the dry run against it.
  @discardableResult
  public func setPolicy(_ next: Policy) async -> Bool {
    guard let backend = backend() else { return false }
    let previous = preview
    preview?.policy = next
    do {
      _ = try await backend.request(ArgusProtocol.Methods.WorktreesSetCleanupPolicy.self, next)
      await load()
      return true
    } catch {
      preview = previous
      self.error = HostStore.describe(error)
      return false
    }
  }

  @discardableResult
  public func cleanUpNow() async -> ArgusProtocol.WorktreeCleanupSweep? {
    guard let backend = backend(), !cleaning else { return nil }
    cleaning = true
    defer { cleaning = false }
    do {
      let sweep = try await backend.request(ArgusProtocol.Methods.WorktreesCleanupRun.self, .init())
      await load()
      return sweep
    } catch {
      self.error = HostStore.describe(error)
      return nil
    }
  }

  #if DEBUG
    /// Gallery stories render the cleanup without a host.
    public func galleryFill(_ preview: ArgusProtocol.WorktreeCleanupPreview) { self.preview = preview }
  #endif
}
