import Foundation
import Testing
@testable import ArgusKit

/// Parsed against the TypeScript `parseDiff` over a real `git diff --cached`
/// covering all four statuses. Path handling and line numbering are where a
/// diff parser quietly goes wrong, so both are compared element by element.
@Suite("Unified diff parsing")
struct DiffParserTests {
  struct Fixture: Decodable {
    struct Line: Decodable {
      var type: String
      var content: String
      var oldNumber: Int?
      var newNumber: Int?
    }
    struct Hunk: Decodable {
      var header: String
      var lines: [Line]
    }
    struct File: Decodable {
      var oldPath: String
      var newPath: String
      var status: String
      var hunks: [Hunk]
    }
    var raw: String
    var files: [File]
  }

  private func fixture() throws -> Fixture {
    let url = Bundle.module.url(forResource: "diff-sample", withExtension: "json")!
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  }

  private func kindName(_ kind: DiffLineKind) -> String {
    kind == .noNewline ? "no-newline" : kind.rawValue
  }

  @Test("matches the TypeScript parser file for file")
  func matchesReference() throws {
    let f = try fixture()
    let parsed = DiffParser.parse(f.raw)

    #expect(parsed.count == f.files.count)
    for (mine, theirs) in zip(parsed, f.files) {
      #expect(mine.oldPath == theirs.oldPath)
      #expect(mine.newPath == theirs.newPath)
      #expect(mine.status.rawValue == theirs.status)
      #expect(mine.hunks.count == theirs.hunks.count)

      for (myHunk, theirHunk) in zip(mine.hunks, theirs.hunks) {
        #expect(myHunk.header == theirHunk.header)
        #expect(myHunk.lines.count == theirHunk.lines.count)
        for (myLine, theirLine) in zip(myHunk.lines, theirHunk.lines) {
          #expect(kindName(myLine.kind) == theirLine.type)
          #expect(myLine.text == theirLine.content)
          #expect(myLine.oldNumber == theirLine.oldNumber)
          #expect(myLine.newNumber == theirLine.newNumber)
        }
      }
    }
  }

  @Test("derives the four statuses the way git presents them")
  func statuses() throws {
    let byPath = Dictionary(
      uniqueKeysWithValues: DiffParser.parse(try fixture().raw).map { ($0.displayPath, $0) })

    #expect(byPath["added.txt"]?.status == .added)
    #expect(byPath["keep.txt"]?.status == .modified)
    #expect(byPath["remove.txt"]?.status == .deleted)
    #expect(byPath["after.txt"]?.status == .renamed)
    // A rename keeps where it came from, which the UI shows as "from …".
    #expect(byPath["after.txt"]?.oldPath == "before.txt")
  }

  @Test("counts additions and deletions per file")
  func counts() throws {
    let byPath = Dictionary(
      uniqueKeysWithValues: DiffParser.parse(try fixture().raw).map { ($0.displayPath, $0) })
    // keep.txt: "two" became "TWO" and "four" was appended.
    #expect(byPath["keep.txt"]?.additions == 2)
    #expect(byPath["keep.txt"]?.deletions == 1)
    #expect(byPath["remove.txt"]?.deletions == 1)
  }

  @Test("carries the no-newline marker without numbering it")
  func noNewline() throws {
    let files = DiffParser.parse(try fixture().raw)
    let markers = files.flatMap(\.hunks).flatMap(\.lines).filter { $0.kind == .noNewline }
    // added.txt was written without a trailing newline.
    #expect(!markers.isEmpty)
    #expect(markers.allSatisfy { $0.oldNumber == nil && $0.newNumber == nil })
  }

  @Test("an empty diff yields no files")
  func empty() {
    #expect(DiffParser.parse("").isEmpty)
    #expect(DiffParser.parse("no diff here\njust text").isEmpty)
  }
}

@Suite("Inline edit previews")
struct InlineDiffTests {
  @Test("a middle replacement keeps the shared edges as context")
  func middleReplacement() {
    let lines = InlineDiff.compute(old: "a\nb\nc", new: "a\nB\nc")
    #expect(lines.map(\.kind) == [.context, .remove, .add, .context])
    #expect(lines[1].text == "b")
    #expect(lines[2].text == "B")
    #expect(lines[1].oldNumber == 2)
    #expect(lines[2].newNumber == 2)
  }

  @Test("stats count only what actually changed")
  func stats() {
    #expect(InlineDiff.stats(old: "a\nb\nc", new: "a\nB\nc") == .init(additions: 1, deletions: 1))
    #expect(InlineDiff.stats(old: "a", new: "a") == .init(additions: 0, deletions: 0))
    #expect(InlineDiff.stats(old: "", new: "x\ny") == .init(additions: 2, deletions: 0))
  }

  @Test("a Write is all additions, and an empty one is nothing")
  func writes() {
    #expect(InlineDiff.writeLines("x\ny").map(\.kind) == [.add, .add])
    #expect(InlineDiff.writeStats("x\ny") == .init(additions: 2, deletions: 0))
    #expect(InlineDiff.writeStats("") == .init(additions: 0, deletions: 0))
  }
}

/// Proposals are written by an agent through an MCP tool whose schema is
/// looser than the protocol's, and results aren't re-validated on the way
/// out — so optional-upstream fields really do arrive missing.
@Suite("Proposal decoding tolerance")
struct ProposalDecodingTests {
  private func decode(_ json: String) throws -> RemoteProposal {
    try JSONDecoder().decode(RemoteProposal.self, from: Data(json.utf8))
  }

  private func proposal(cta: String) -> String {
    """
    {"id":"p1","automation_id":"a1","automation_name":"Branch janitor",
     "title":"Delete merged branch","summary":"s","rationale":"r",
     "confidence":0.8,"status":"pending","project":null,
     "source_label":null,"source_url":null,"session_id":null,
     "created_at":1,"cta":\(cta)}
    """
  }

  @Test("a cta without `force` decodes and defaults to a safe delete")
  func missingForce() throws {
    let parsed = try decode(
      proposal(
        cta: """
          {"kind":"delete_branch","label":"Delete","url":null,"branch":"old","session_id":null}
          """))
    #expect(parsed.cta?.force == false)
    #expect(parsed.cta?.branch == "old")
  }

  @Test("an explicit force survives")
  func explicitForce() throws {
    let parsed = try decode(
      proposal(
        cta: """
          {"kind":"delete_branch","label":"Delete","url":null,"branch":"old",
           "force":true,"session_id":null}
          """))
    #expect(parsed.cta?.force == true)
  }

  @Test("a proposal with no cta at all is still readable")
  func noCta() throws {
    #expect(try decode(proposal(cta: "null")).cta == nil)
  }
}
