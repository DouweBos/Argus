import ArgusKit
import Foundation

/// The Mac's bundled host over its local socket: `account_link_local_begin`
/// for its member record and proof, `account_link_local_finish` once the
/// `add_host` is in the log.
@MainActor
public final class LocalHostAccountLink: AccountLocalHostLinking {
  /// Set once the host is up; nil while it isn't, or for a window that only
  /// attached to another app's host.
  public var backend: (any HostBackend)?

  public init(backend: (any HostBackend)? = nil) {
    self.backend = backend
  }

  public func begin() async throws -> (host: AccountMember, proof: String) {
    guard let backend else { throw AccountStoreError.notReady }
    let offer = try await backend.request(ArgusProtocol.Commands.AccountLinkLocalBegin.self, EmptyParams())
    let host = offer.host
    return (
      AccountMember(
        id: host.id, role: .host, platform: host.platform.rawValue, signPub: host.signPub,
        noisePub: host.noisePub, name: host.name, createdAt: host.createdAt),
      offer.proof
    )
  }

  public func finish(root: AccountRoot) async throws {
    guard let backend else { throw AccountStoreError.notReady }
    _ = try await backend.request(
      ArgusProtocol.Commands.AccountLinkLocalFinish.self,
      .init(accountId: root.accountId, epoch: root.epoch, genesisHash: root.genesisHash))
  }
}
