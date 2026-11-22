import Foundation
import GroveKit
import Testing

@testable import Argus

/// A worktree on another machine: its files aren't on this Mac's disk.
private struct FarRunner: GitRunner {
  var files: [String: Data] = [:]
  var temporaryDirectory: URL { URL(fileURLWithPath: "/far/scratch") }

  func readFile(at url: URL) async throws -> Data {
    guard let data = files[url.path] else { throw CocoaError(.fileReadNoSuchFile) }
    return data
  }

  func run(_ invocation: GitInvocation) async throws -> ShellResult { throw CocoaError(.featureUnsupported) }
  func runStreaming(_ invocation: GitInvocation, onStderr: @escaping @Sendable (String) -> Void) async throws
    -> ShellResult
  { throw CocoaError(.featureUnsupported) }
  func itemKind(at url: URL) async -> FileItemKind? { nil }
  func writeFile(_ data: Data, to url: URL, executable: Bool) async throws {}
  func removeItem(at url: URL) async throws {}
  func createDirectory(at url: URL) async throws {}
  func moveItem(at source: URL, to destination: URL) async throws {}
  func contentsOfDirectory(at url: URL) async throws -> [String] { [] }
}

@MainActor
struct ConflictResultTests {
  private let worktree = URL(fileURLWithPath: "/far/repo")

  @Test func readsWhereTheWorktreeIs() async {
    let text = "<<<<<<< ours\r\na\r\n=======\r\nb\r\n>>>>>>> theirs"
    let runner = FarRunner(files: ["/far/repo/dir/file.txt": Data(text.utf8)])
    #expect(await ConflictResult.read("dir/file.txt", in: worktree, runner: runner) == .loaded(text))
  }

  @Test func aFailedReadHasNothingToSave() async {
    let result = await ConflictResult.read("gone.txt", in: worktree, runner: FarRunner())
    #expect(result.text == nil)
    guard case .unreadable = result else {
      Issue.record("expected an unreadable result, got \(result)")
      return
    }
  }

  @Test func bytesThatAreNotTextHaveNothingToSave() async {
    let runner = FarRunner(files: ["/far/repo/logo.bin": Data([0xFF, 0xFE, 0x00, 0xC3])])
    #expect(await ConflictResult.read("logo.bin", in: worktree, runner: runner).text == nil)
  }

  @Test func savesBackTheSameBytes() async {
    let bytes = Data([0xEF, 0xBB, 0xBF]) + Data("no newline at the end".utf8)
    let runner = FarRunner(files: ["/far/repo/bom.txt": bytes])
    let text = await ConflictResult.read("bom.txt", in: worktree, runner: runner).text
    #expect(text.map { Data($0.utf8) } == bytes)
  }

  @Test func anEmptyFileIsStillReadable() async {
    let runner = FarRunner(files: ["/far/repo/empty": Data()])
    #expect(await ConflictResult.read("empty", in: worktree, runner: runner) == .loaded(""))
  }
}
