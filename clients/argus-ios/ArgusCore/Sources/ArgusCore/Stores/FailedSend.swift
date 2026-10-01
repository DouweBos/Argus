import Foundation

/// A message this client could not hand to the computer. It keeps the body it
/// would have sent — preamble and attachments included — so retrying is one
/// tap rather than retyping.
public struct FailedSend: Identifiable, Sendable, Equatable {
  public var id: String
  public var body: String
  public var displayText: String?
  public var images: [RemoteImageAttachment]

  public init(id: String, body: String, displayText: String?, images: [RemoteImageAttachment]) {
    self.id = id
    self.body = body
    self.displayText = displayText
    self.images = images
  }

  /// What the user actually typed, without the linked-projects preamble.
  public var text: String {
    LinkedProjects.parsePreamble(body)?.rest ?? displayText ?? body
  }
}
