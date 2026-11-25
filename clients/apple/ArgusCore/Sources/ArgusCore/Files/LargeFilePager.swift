import ArgusKit
import Foundation
import Observation

/// A file too large to open whole, read a page at a time from the host. Pages start on a line
/// the previous one ended on, so line numbers follow from counting line breaks.
@MainActor
@Observable
public final class LargeFilePager {
  public struct Page: Equatable, Sendable {
    public let lines: [String]
    /// 1-based number of `lines[0]`.
    public let firstLine: Int
    public let offset: Int
    public let end: Int
    /// Line breaks in the page: where the next one's numbering starts.
    let breaks: Int
  }

  public typealias Read = @Sendable (_ offset: Int, _ length: Int) async throws -> ArgusProtocol.CodeFileRange

  public static let pageBytes = 256 * 1024

  public let size: Int
  public private(set) var page: Page?
  public private(set) var isLoading = false
  public private(set) var failure: String?
  /// The file holds NUL bytes: it isn't text, so there's nothing to page through.
  public private(set) var isBinary = false
  /// Where each page before this one started, for Previous.
  private var back: [(offset: Int, firstLine: Int)] = []
  private let read: Read
  private let pageBytes: Int

  public init(size: Int, pageBytes: Int = LargeFilePager.pageBytes, read: @escaping Read) {
    self.size = size
    self.pageBytes = pageBytes
    self.read = read
  }

  public var hasNext: Bool { page.map { $0.end < size } ?? false }
  public var hasPrevious: Bool { !back.isEmpty }
  /// How far through the file this page ends, 0...1.
  public var progress: Double { size == 0 ? 1 : min(1, Double(page?.end ?? 0) / Double(size)) }

  public func start() async {
    back = []
    await load(offset: 0, firstLine: 1)
  }

  public func next() async {
    guard let page, hasNext, !isLoading else { return }
    back.append((page.offset, page.firstLine))
    await load(offset: page.end, firstLine: page.firstLine + page.breaks)
  }

  public func previous() async {
    guard let last = back.last, !isLoading else { return }
    back.removeLast()
    await load(offset: last.offset, firstLine: last.firstLine)
  }

  private func load(offset: Int, firstLine: Int) async {
    isLoading = true
    defer { isLoading = false }
    do {
      let range = try await read(offset, pageBytes)
      if range.binary {
        isBinary = true
        page = nil
        return
      }
      page = Self.page(range, firstLine: firstLine)
      failure = nil
    } catch {
      failure = HostStore.describe(error)
    }
  }

  static func page(_ range: ArgusProtocol.CodeFileRange, firstLine: Int) -> Page {
    // `\r\n` is one Character in Swift.
    var lines = range.text.split(omittingEmptySubsequences: false) { $0 == "\n" || $0 == "\r\n" }.map(String.init)
    let breaks = lines.count - 1
    if lines.count > 1, lines.last == "" { lines.removeLast() }
    return Page(lines: lines, firstLine: firstLine, offset: range.offset, end: range.end, breaks: breaks)
  }
}
