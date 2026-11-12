import ArgusKit

/// What the Accounts page shows for a runner besides Claude Code, shared by the
/// Mac and the phone so both read a status the same way.
extension ArgusProtocol.RunnerAccount: Identifiable {
  public enum Action: String, Sendable, CaseIterable {
    case install, signIn, signOut, checkAgain
  }

  public enum Tone: Sendable { case success, warning, muted }

  public var isInstalled: Bool { status != .notInstalled }

  public var statusLabel: String {
    switch status {
    case .signedIn: "Signed in"
    case .signedOut: "Not signed in"
    case .notInstalled: "Not installed"
    default: canProbe ? "Status unknown" : "Can't check sign-in"
    }
  }

  public var tone: Tone {
    switch status {
    case .signedIn: .success
    case .signedOut: .warning
    default: .muted
    }
  }

  /// The account, then the status, as the row's second line.
  public var subtitle: String {
    [account, statusLabel].compactMap { $0 }.joined(separator: " · ")
  }

  /// The one action the row leads with; the rest go in its menu.
  public var primaryAction: Action? {
    switch status {
    case .notInstalled: (setup?.installCommand ?? setup?.installUrl) != nil ? .install : nil
    case .signedOut: setup?.loginCommand != nil ? .signIn : nil
    case .signedIn: nil
    default: setup?.loginCommand != nil ? .signIn : nil
    }
  }

  /// Everything this runner offers, in menu order.
  public var actions: [Action] {
    var actions: [Action] = []
    if !isInstalled, (setup?.installCommand ?? setup?.installUrl) != nil { actions.append(.install) }
    if isInstalled, status != .signedIn, setup?.loginCommand != nil { actions.append(.signIn) }
    if isInstalled, status != .signedOut, setup?.logoutCommand != nil { actions.append(.signOut) }
    actions.append(.checkAgain)
    return actions
  }
}

extension ArgusProtocol.RunnerAccount.Action {
  public var title: String {
    switch self {
    case .install: "Install"
    case .signIn: "Sign In"
    case .signOut: "Sign Out"
    case .checkAgain: "Check Again"
    }
  }
}

/// The page's runner rows: installed ones always shown, missing ones folded
/// under a disclosure once there are enough of them to crowd the list.
public struct RunnerAccountSections: Sendable {
  public let installed: [ArgusProtocol.RunnerAccount]
  public let missing: [ArgusProtocol.RunnerAccount]
  public let collapsesMissing: Bool

  public static let collapseThreshold = 4

  public init(_ accounts: [ArgusProtocol.RunnerAccount]) {
    installed = accounts.filter(\.isInstalled)
    missing = accounts.filter { !$0.isInstalled }
    collapsesMissing = missing.count >= Self.collapseThreshold
  }
}
