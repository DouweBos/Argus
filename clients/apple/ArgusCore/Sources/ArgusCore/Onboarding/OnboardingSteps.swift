import ArgusKit
import Foundation

/// The Mac's first run. The desktop's welcome and privacy steps, then the
/// checks it moved to home-screen cards and a first project, so a new user
/// lands with something to work in.
///
/// The host stores the desktop's steps (welcome, telemetry, projects), so a
/// resume between privacy and the project step comes from what this app remembered.
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
    switch self {
    case .welcome: .welcome
    case .privacy, .setup: .telemetry
    case .project: .projects
    }
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
    switch hostStep {
    case .projects: return .project
    case .telemetry:
      // Older builds stored the project step as telemetry too.
      if let local = local.flatMap(OnboardingStepId.init(rawValue:)), local != .welcome { return local }
      return .privacy
    default: return .welcome
    }
  }
}
