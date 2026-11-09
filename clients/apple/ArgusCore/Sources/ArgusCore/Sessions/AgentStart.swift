import ArgusKit
import Foundation

/// The first message of an agent that doesn't exist yet, as a start composer collected it.
public struct ComposerStart: Sendable {
  public let message: String
  public let displayText: String
  public let images: [RemoteImageAttachment]
  /// Nil keeps the starter's default.
  public let permissionMode: RemotePermissionMode?
  /// Picked in the model pill or with `/model`; nil lets the runner choose.
  public let model: String?
  /// Picked in the effort pill; nil keeps the model's default.
  public let effort: String?
  /// Nil is the computer's default runner.
  public let runnerId: String?

  public init(
    message: String, displayText: String, images: [RemoteImageAttachment] = [],
    permissionMode: RemotePermissionMode? = nil, model: String? = nil, effort: String? = nil,
    runnerId: String? = nil
  ) {
    self.message = message
    self.displayText = displayText
    self.images = images
    self.permissionMode = permissionMode
    self.model = model
    self.effort = effort
    self.runnerId = runnerId
  }
}

/// What a start falls back to where the request leaves a choice open: the
/// Mac's Settings defaults, or the phone's.
public struct AgentStartDefaults: Sendable {
  /// A raw permission mode, so the Mac's `trusted` — which no gateway mode carries — fits.
  public let mode: String?
  public let model: String?
  public let effort: String?

  public init(mode: String? = nil, model: String? = nil, effort: String? = nil) {
    self.mode = mode
    self.model = model
    self.effort = effort
  }
}

extension ComposerStart {
  /// Settings' default model and effort belong to the default runner; another runner picks its own.
  func model(or defaults: AgentStartDefaults) -> String? {
    model ?? (runnerId == nil ? defaults.model : nil)
  }

  func effort(or defaults: AgentStartDefaults) -> String? {
    effort ?? (runnerId == nil ? defaults.effort : nil)
  }
}
