import ArgusKit
import Foundation

extension HostStore {
  /// What one base64 envelope can carry; the chunked transfer channel Electron
  /// uses for bigger files isn't in ArgusKit yet.
  public static let maxDroppedFileBytes = 8 * 1024 * 1024

  public struct DroppedFiles: Sendable {
    /// Paths on the session's machine, ready to @-mention.
    public var paths: [String]
    /// One message per file that couldn't be made available to the agent.
    public var errors: [String]

    public init(paths: [String], errors: [String]) {
      self.paths = paths
      self.errors = errors
    }
  }

  /// Files dropped on the chat, as paths the agent can open: their own paths
  /// for a session on this machine; uploaded to the host first for one on
  /// another, as Electron's `resolveDroppedFilePaths` does.
  public func hostPaths(forDropped urls: [URL], sessionId: String?) async -> DroppedFiles {
    guard let sessionId, hooks.sessionIsRemote(sessionId) else {
      return DroppedFiles(paths: urls.map(\.path), errors: [])
    }
    guard let backend else { return DroppedFiles(paths: [], errors: ["Not connected."]) }
    var result = DroppedFiles(paths: [], errors: [])
    for url in urls {
      let name = url.lastPathComponent
      guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
        result.errors.append("\(name) couldn't be read.")
        continue
      }
      guard data.count <= Self.maxDroppedFileBytes else {
        result.errors.append(
          "\(name) is too big to send to that machine (\(Self.maxDroppedFileBytes / 1024 / 1024) MB at most).")
        continue
      }
      do {
        let uploaded = try await backend.request(
          ArgusProtocol.Commands.UploadSessionAttachment.self,
          .init(id: sessionId, name: name, data: data.base64EncodedString()))
        result.paths.append(uploaded.path)
      } catch {
        result.errors.append("\(name): \(Self.describe(error))")
      }
    }
    for error in result.errors { report(DroppedFileError(message: error), scope: "chat") }
    return result
  }
}

/// A dropped file the agent's machine couldn't be given.
public struct DroppedFileError: LocalizedError, Sendable {
  public let message: String
  public var errorDescription: String? { message }
}

/// A file attached to a message: one on this machine's disk, or bytes read
/// from where only this device can reach (the phone's Files picker).
public enum AttachmentSource: Sendable {
  case file(URL)
  case bytes(Data)
}

extension HostStore {
  /// One gateway frame carries the upload: `MAX_BASE64_UPLOAD_BYTES` on the host.
  public static let maxAttachmentBytes = maxDroppedFileBytes

  /// Where the session's agent finds an attached file: its own path when the
  /// session runs on this machine, else uploaded into the session's worktree.
  /// Nil after reporting why it couldn't be made available.
  public func hostPath(
    forAttachment name: String, size: Int, source: AttachmentSource, sessionId: String?
  ) async -> String? {
    if case .file(let url) = source, backend?.kind == .local, !(sessionId.map(hooks.sessionIsRemote) ?? false) {
      return url.path
    }
    guard size <= Self.maxAttachmentBytes else { return tooBig(name) }
    guard let sessionId, let backend else { return attachmentFailed("\(name) couldn't be sent: not connected.") }
    let data: Data
    switch source {
    case .bytes(let bytes): data = bytes
    case .file(let url):
      guard let read = try? Data(contentsOf: url, options: .mappedIfSafe) else {
        return attachmentFailed("\(name) couldn't be read.")
      }
      data = read
    }
    guard data.count <= Self.maxAttachmentBytes else { return tooBig(name) }
    do {
      let saved = try await backend.request(
        ArgusProtocol.Methods.SessionsUploadAttachment.self,
        .init(sessionId: sessionId, name: name, data: data.base64EncodedString()))
      return saved.relativePath
    } catch {
      return attachmentFailed("\(name): \(Self.describe(error))")
    }
  }

  private func tooBig(_ name: String) -> String? {
    attachmentFailed("\(name) is too big to send (\(Self.maxAttachmentBytes / 1024 / 1024) MB at most).")
  }

  private func attachmentFailed(_ message: String) -> String? {
    report(DroppedFileError(message: message), scope: "chat")
    return nil
  }
}
