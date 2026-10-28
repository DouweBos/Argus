import ArgusKit
import Foundation

/// The two calls `account.sync` needs on one host connection.
public struct AccountSyncChannel: Sendable {
  public var status: @Sendable () async throws -> ArgusProtocol.MethodsTypes.AccountStatusResult
  public var push: @Sendable (ArgusProtocol.MethodsTypes.AccountSyncParams) async throws -> Void

  public init(
    status: @escaping @Sendable () async throws -> ArgusProtocol.MethodsTypes.AccountStatusResult,
    push: @escaping @Sendable (ArgusProtocol.MethodsTypes.AccountSyncParams) async throws -> Void
  ) {
    self.status = status
    self.push = push
  }

  /// Over a typed backend: the gateway, the local socket, or the router.
  public static func backend(_ backend: any HostBackend) -> AccountSyncChannel {
    AccountSyncChannel(
      status: {
        try await backend.request(
          .accountStatus, EmptyParams(), as: ArgusProtocol.MethodsTypes.AccountStatusResult.self)
      },
      push: { params in
        _ = try await backend.request(
          .accountSync, params, as: ArgusProtocol.MethodsTypes.AccountSyncResult.self)
      })
  }

  /// Over one paired host's link (the Mac's remote hosts).
  public static func link(_ link: RemoteHostLink) -> AccountSyncChannel {
    AccountSyncChannel(
      status: {
        let result = try await link.request(RemoteMethod.accountStatus.rawValue, .object([:]))
        return try ProtocolCodec.convert(result, to: ArgusProtocol.MethodsTypes.AccountStatusResult.self)
      },
      push: { params in
        _ = try await link.request(RemoteMethod.accountSync.rawValue, try ProtocolCodec.convert(params))
      })
  }
}

extension AccountStore {
  /// Hand a connected host the entries of this device's verified log it
  /// hasn't seen (§5.5), so a removal reaches it even while the service holds
  /// it back. Only for a host on the same account; never throws.
  public func sync(over channel: AccountSyncChannel) async {
    guard phase == .ready, let current = state else { return }
    guard let status = try? await channel.status(), status.linked,
      status.accountIdHash == AccountCodec.sha256Hex(current.accountId),
      let hostHead = status.headSeq, hostHead < current.head.seq
    else { return }
    let missing = Array(vault.entries.dropFirst(hostHead + 1).suffix(500))
    guard !missing.isEmpty else { return }
    let params = ArgusProtocol.MethodsTypes.AccountSyncParams(
      epoch: current.epoch, entries: missing.map { .init(body: $0.body, sigs: $0.sigs) })
    try? await channel.push(params)
  }
}
