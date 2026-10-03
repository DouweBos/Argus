import ArgusKit
import Foundation

/// The Mac's first run. The desktop's welcome and privacy steps, then the
/// checks it moved to home-screen cards and a first project, so a new user
/// lands with something to work in.
///
/// The host only stores the desktop's two steps, so a resume past them comes
/// from the step this app remembered, as long as the host still says privacy.
public enum OnboardingStepId: String, CaseIterable, Sendable {
  case welcome
  case privacy
  case setup
  case project

  public var title: String {
    switch self {
    case .welcome: "Welcome"
    case .privacy: "Privacy"
    case .setup: "Set up"
    case .project: "Project"
    }
  }

  /// What the host records for this step.
  public var hostStep: ArgusProtocol.OnboardingStep {
    self == .welcome ? .welcome : .telemetry
  }

  public var next: OnboardingStepId? {
    let all = Self.allCases
    let index = all.firstIndex(of: self)!
    return index + 1 < all.count ? all[index + 1] : nil
  }

  public var previous: OnboardingStepId? {
    let all = Self.allCases
    let index = all.firstIndex(of: self)!
    return index > 0 ? all[index - 1] : nil
  }

  /// Where to pick up: the host's step, refined by what this app remembered.
  public static func resume(hostStep: ArgusProtocol.OnboardingStep, local: String?) -> OnboardingStepId {
    guard hostStep == .telemetry else { return .welcome }
    if let local = local.flatMap(OnboardingStepId.init(rawValue:)), local.hostStep == .telemetry {
      return local
    }
    return .privacy
  }
}
