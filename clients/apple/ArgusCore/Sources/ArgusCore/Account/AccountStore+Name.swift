import ArgusKit
import Foundation

/// This device's name as a setting: joins and links use it, editing it renames
/// this device (and the Mac's bundled host) on the account, and a rename made
/// from another device flows back into it.
extension AccountStore {
  /// This device on the account, and the Mac's bundled host: one name for both.
  var ownMemberIds: [String] { [vault.keys?.memberId, vault.localHostId].compactMap { $0 } }

  public func isOwnMember(_ memberId: String) -> Bool { ownMemberIds.contains(memberId) }

  /// The keys to join or start an account with, carrying the current name.
  /// The proof of possession doesn't cover the name, so it can change freely.
  func currentKeys() -> AccountDeviceKeys {
    guard var keys = vault.keys else {
      return AccountDeviceKeys.generate(kind: deviceKind, name: deviceName(), now: now())
    }
    keys.name = AccountDeviceKeys.memberName(deviceName())
    return keys
  }

  /// The name setting changed. The app persists it through `onNameChanged`;
  /// it goes on the account now, or as soon as the service is reachable.
  @discardableResult
  public func setName(_ raw: String, source: NameSource) async -> Bool {
    guard let name = AccountDeviceKeys.validatedName(raw) else {
      error = "Names are 1–64 characters on one line."
      return false
    }
    error = nil
    onNameChanged(name)
    onEvent(.nameChanged(source: source, linked: phase == .ready))
    if vault.keys != nil {
      vault.pendingName = name
      await vaultStore.save(vault)
    }
    await flushName()
    return true
  }

  /// Rename this device and the bundled host to the pending name. A failure
  /// leaves it pending for the next refresh.
  func flushName() async {
    while phase == .ready, let name = vault.pendingName {
      do {
        for id in ownMemberIds {
          guard let member = state?.liveMember(id)?.member, member.name != name else { continue }
          try await appendWithRetry { [self] head in
            [try entry(head: head, .rename(memberId: id, name: name))]
          }
        }
      } catch {
        return
      }
      // Edited again meanwhile: go round with the newer name.
      guard vault.pendingName == name else { continue }
      vault.pendingName = nil
      await vaultStore.save(vault)
    }
  }

  /// Another device renamed this one or the bundled host: the setting follows,
  /// and the other is brought in line. Never over a local edit still pending.
  func reflectName(from prior: AccountLogState, to next: AccountLogState) {
    guard vault.pendingName == nil else { return }
    let current = deviceName()
    for id in ownMemberIds {
      guard let after = next.liveMember(id)?.member.name,
        after != prior.liveMember(id)?.member.name, after != current
      else { continue }
      onNameChanged(after)
      if ownMemberIds.contains(where: { next.liveMember($0).map { $0.member.name != after } ?? false }) {
        vault.pendingName = after
      }
      return
    }
  }
}
