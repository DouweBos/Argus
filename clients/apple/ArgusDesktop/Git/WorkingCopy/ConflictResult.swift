import ArgusCore
import Foundation
import GroveKit

/// A conflicted file as it sits in the working tree, read where the worktree is.
enum ConflictResult: Equatable {
  case loading
  case loaded(String)
  /// Unknown contents: never offered for saving, which would replace the file with them.
  case unreadable(String)

  var text: String? {
    if case .loaded(let text) = self { text } else { nil }
  }

  @MainActor
  static func read(_ path: String, in worktree: URL, runner: any GitRunner) async -> ConflictResult {
    do {
      let data = try await runner.readFile(at: worktree.appendingPathComponent(path))
      // Unlike `String(data:encoding:)`, keeps a byte order mark for the save to write back.
      guard let text = String(validating: data, as: UTF8.self) else {
        return .unreadable("It isn't UTF-8 text. Take a side, or resolve it outside Argus.")
      }
      return .loaded(text)
    } catch {
      return .unreadable(HostStore.describe(error))
    }
  }
}
