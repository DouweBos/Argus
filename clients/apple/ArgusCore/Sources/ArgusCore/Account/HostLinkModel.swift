import ArgusKit
import Foundation
import Observation

/// Linking a host to the account with a code, as `argus-host login` does: the
/// host shows a code, a phone adds it, both sides compare the 6-digit code.
/// Driven over the host's local socket by the Mac app's Settings and the
/// server's menu.
@MainActor
@Observable
public final class HostLinkModel {
  public private(set) var state: ArgusProtocol.AccountLinkState?
  /// Why the last request failed.
  public private(set) var failure: String?
  /// The account was reset elsewhere and the host went unlinked: link it again.
  public private(set) var reset: ArgusProtocol.AccountResetNotice?
  @ObservationIgnored private let surface: ArgusProtocol.AccountLinkSurface
  @ObservationIgnored private var backend: (any HostBackend)?
  @ObservationIgnored private var poll: Task<Void, Never>?
  @ObservationIgnored public var pollInterval: Duration = .seconds(2)

  public init(surface: ArgusProtocol.AccountLinkSurface) {
    self.surface = surface
  }

  public func start(_ backend: (any HostBackend)?) async {
    guard let backend else { return }
    self.backend = backend
    guard await run({ try await backend.request(ArgusProtocol.Commands.AccountLoginStart.self, .init(surface: surface)) })
    else { return }
    startPolling()
  }

  public func confirm(_ match: Bool) async {
    guard let backend else { return }
    await run { try await backend.request(ArgusProtocol.Commands.AccountLoginConfirm.self, .init(match: match)) }
  }

  public func cancel() async {
    stopPolling()
    guard let backend else { return }
    await run { try await backend.request(ArgusProtocol.Commands.AccountLoginCancel.self, EmptyParams()) }
  }

  /// Read where the host is, including a reset it noticed.
  public func load(_ backend: (any HostBackend)?) async {
    guard let backend,
      let status = try? await backend.request(ArgusProtocol.Commands.AccountGetStatus.self, EmptyParams())
    else { return }
    state = status.link
    reset = status.linked ? nil : status.reset
  }

  /// The host moved on its own (an `account:link-state` event, or a status read).
  public func observe(_ next: ArgusProtocol.AccountLinkState) {
    state = next
  }

  /// A failed request says why instead of doing nothing. An older Argus running
  /// the host has no account commands at all, so that's the likely cause.
  @discardableResult
  private func run(_ request: () async throws -> ArgusProtocol.AccountLinkState) async -> Bool {
    do {
      state = try await request()
      failure = nil
      return true
    } catch {
      failure =
        "Couldn't reach the host for linking (\(error.localizedDescription)). If another Argus app is running it, that app may be too old for accounts: update or quit it, then try again."
      return false
    }
  }

  /// The host moves on its own (claimed, approver found); read where it is.
  private func startPolling() {
    poll?.cancel()
    poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: self?.pollInterval ?? .seconds(2))
        guard let self, let backend = self.backend,
          let status = try? await backend.request(ArgusProtocol.Commands.AccountGetStatus.self, EmptyParams())
        else { continue }
        self.state = status.link
        self.reset = status.linked ? nil : status.reset
        switch status.link {
        case .linked, .error, .idle: return
        default: continue
        }
      }
    }
  }

  public func stopPolling() {
    poll?.cancel()
    poll = nil
  }
}
