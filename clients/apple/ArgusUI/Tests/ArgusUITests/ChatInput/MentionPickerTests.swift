import Foundation
import Testing

@testable import ArgusUI

@Suite("MentionPicker")
struct MentionPickerTests {
  @Test("a mention starts at an @ that begins a word and runs to the caret")
  func detect() {
    #expect(MentionPicker.detect(in: "@src", caret: 4) == .init(query: "src", start: 0))
    #expect(MentionPicker.detect(in: "see @ap", caret: 7) == .init(query: "ap", start: 4))
    #expect(MentionPicker.detect(in: "mail@host", caret: 9) == nil)
    #expect(MentionPicker.detect(in: "@src lib", caret: 8) == nil)
    // The caret, not the end of the text, decides.
    #expect(MentionPicker.detect(in: "@ab rest", caret: 3) == .init(query: "ab", start: 0))
  }

  @Test("offsets are UTF-16, like NSTextView's selection")
  func utf16() {
    let text = "hé 🙂 @fi"
    let caret = (text as NSString).length
    #expect(MentionPicker.detect(in: text, caret: caret)?.start == caret - 3)
  }

  @Test("a slash, ~ or . switches to browsing")
  func browseSplit() {
    #expect(MentionPicker.splitBrowse("src/comp") == ("src/", "comp"))
    #expect(MentionPicker.splitBrowse("src/") == ("src/", ""))
    #expect(MentionPicker.splitBrowse("~Work") == ("~/", "work"))
    #expect(MentionPicker.splitBrowse("~") == ("~", ""))
    #expect(MentionPicker.splitBrowse(".git") == ("./", "git"))
  }

  @Test("search lists matching directories first, then files, ranked by basename")
  func search() {
    let files = ["app/App.tsx", "app/lib/app.ts", "src/main.swift", "README.md"]
    let dirs = MentionPicker.directories(of: files)
    #expect(dirs == ["app", "app/lib", "src"])

    let items = MentionPicker.search(files: files, directories: dirs, query: "app")
    #expect(items.map(\.display) == ["app", "lib", "App.tsx", "app.ts"])
    #expect(items.first?.isDirectory == true)
    #expect(items[3].hint == "app/lib")
  }

  @Test("search caps directories at six and the total at twelve")
  func caps() {
    let files = (0..<20).map { "d\($0)/f\($0).txt" }
    let items = MentionPicker.search(
      files: files, directories: MentionPicker.directories(of: files), query: "")
    #expect(items.filter(\.isDirectory).count == 6)
    #expect(items.count == 12)
  }

  @Test("browsing leads with linking the directory, then filters its entries")
  func browse() {
    let items = MentionPicker.browse(
      directory: "src/",
      entries: [("views", true), ("main.swift", false), ("Info.plist", false)],
      filter: "i")
    #expect(items.first == .init(display: "src", isDirectory: true, isLinkAction: true))
    #expect(items.dropFirst().map(\.display) == ["Info.plist", "views", "main.swift"])
  }

  @Test("a file inserts @path and a space; a directory drills in")
  func apply() {
    let context = MentionPicker.Context(query: "ma", start: 4)
    let file = MentionPicker.Item(display: "main.swift", hint: "src", isDirectory: false)
    let picked = MentionPicker.apply(file, in: context, to: "see @ma now")
    #expect(picked.text == "see @src/main.swift  now")
    #expect(picked.caret == 20)

    let dir = MentionPicker.Item(display: "src", hint: "", isDirectory: true)
    #expect(MentionPicker.apply(dir, in: context, to: "see @ma").text == "see @src/")

    let browsing = MentionPicker.Context(query: "src/", start: 0)
    let link = MentionPicker.Item(display: "src", isDirectory: true, isLinkAction: true)
    #expect(MentionPicker.apply(link, in: browsing, to: "@src/").text == "@src ")
    let entry = MentionPicker.Item(display: "views", isDirectory: true)
    #expect(MentionPicker.apply(entry, in: browsing, to: "@src/").text == "@src/views/")
  }

  @Test("dropped files become escaped mentions")
  func fileMentions() {
    let edit = MentionPicker.insertingFileMentions(
      ["/tmp/a b.txt", "/tmp/c"], into: "look at", caret: 7)
    #expect(edit.text == "look at @/tmp/a\\ b.txt @/tmp/c ")
    #expect(edit.caret == (edit.text as NSString).length)
    #expect(MentionPicker.insertingFileMentions(["/x"], into: "", caret: 0).text == "@/x ")
  }

  @Test("the header names the browsed directory")
  func header() {
    #expect(MentionPicker.header(for: .init(query: "fi", start: 0)) == "Files")
    #expect(MentionPicker.header(for: .init(query: "src/v", start: 0)) == "src/")
  }
}
