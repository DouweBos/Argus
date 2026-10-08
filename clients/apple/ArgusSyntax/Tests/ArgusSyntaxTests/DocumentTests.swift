import Foundation
import Testing

@testable import ArgusSyntax

@Suite struct DocumentTests {
  /// Random-ish edits applied incrementally must colour exactly like a fresh parse.
  @Test(arguments: [SyntaxLanguage.swift, .typescript, .markdown, .html, .python])
  func incrementalMatchesFreshParse(language: SyntaxLanguage) async throws {
    var text = Fixtures.source(for: language)
    let document = try #require(SyntaxDocument(language: language, text: text))
    let edits: [(Int, Int, String)] = [
      (0, 0, "// head\n"), (5, 3, ""), (12, 0, "\"quoted\" 42\n"), (20, 4, "x"),
      (3, 0, "\n\n"), (30, 10, "🙂 é\n"),
    ]
    for (location, length, insert) in edits {
      let ns = text as NSString
      let range = NSRange(location: min(location, ns.length), length: min(length, max(0, ns.length - location)))
      text = ns.replacingCharacters(in: range, with: insert)
      await document.edit(range: range, newText: insert, fullText: text)
      let full = NSRange(location: 0, length: (text as NSString).length)
      let incremental = await document.highlights(in: full)
      #expect(incremental == SyntaxHighlighter.highlight(text, language: language))
    }
  }

  @Test func visibleRangeIsASliceOfTheWhole() async throws {
    let text = Fixtures.source(for: .swift)
    let document = try #require(SyntaxDocument(language: .swift, text: text))
    let all = await document.highlights(in: NSRange(location: 0, length: (text as NSString).length))
    let window = NSRange(location: 40, length: 60)
    let slice = await document.highlights(in: window)
    expectSortedAndDisjoint(slice)
    for run in slice {
      #expect(NSIntersectionRange(run.range, window) == run.range)
      #expect(all.contains { NSIntersectionRange($0.range, run.range) == run.range && $0.capture == run.capture })
    }
  }

  @Test func mismatchedEditResyncsFromFullText() async throws {
    let document = try #require(SyntaxDocument(language: .json, text: "{}"))
    let text = "{\"a\": 1}"
    await document.edit(range: NSRange(location: 40, length: 2), newText: "zz", fullText: text)
    #expect(await document.highlights(in: NSRange(location: 0, length: 8)) == SyntaxHighlighter.highlight(text, language: .json))
  }

  @Test func replaceAllReparses() async throws {
    let document = try #require(SyntaxDocument(language: .python, text: "x = 1"))
    await document.replaceAll("# note")
    #expect(await document.highlights(in: NSRange(location: 0, length: 6)) == [SyntaxRun(range: NSRange(location: 0, length: 6), capture: .comment)])
  }
}

@Suite struct DetectionTests {
  @Test(arguments: [
    ("Sources/App/Foo.swift", SyntaxLanguage.swift), ("a/b.ts", .typescript), ("x.mts", .typescript),
    ("View.tsx", .tsx), ("index.js", .javascript), ("Comp.jsx", .javascript), ("lib.mjs", .javascript),
    ("package.json", .json), ("Package.resolved", .json), ("README.md", .markdown),
    ("Main.kt", .kotlin), ("build.gradle.kts", .kotlin), ("App.java", .java), ("AppDelegate.m", .objc),
    ("Bridge.mm", .objc), ("Header.h", .objc), ("ci.yml", .yaml), ("x.yaml", .yaml),
    ("run.sh", .bash), (".zshrc", .bash), ("site.css", .css), ("index.html", .html),
    ("tool.py", .python), ("Podfile", .ruby), ("Gemfile", .ruby), ("fastlane/Fastfile", .ruby),
    ("x.rb", .ruby), ("main.go", .go), ("lib.rs", .rust), ("FOO.SWIFT", .swift),
  ])
  func detectsByPath(path: String, expected: SyntaxLanguage) {
    #expect(SyntaxLanguage.detect(path: path, firstLine: nil) == expected)
  }

  @Test func detectsByShebang() {
    #expect(SyntaxLanguage.detect(path: "bin/tool", firstLine: "#!/usr/bin/env python3") == .python)
    #expect(SyntaxLanguage.detect(path: "bin/tool", firstLine: "#!/bin/bash -e") == .bash)
    #expect(SyntaxLanguage.detect(path: "bin/tool", firstLine: "#!/usr/bin/env -S node --no-warnings") == .javascript)
    #expect(SyntaxLanguage.detect(path: "bin/tool", firstLine: "#!/usr/bin/ruby") == .ruby)
    #expect(SyntaxLanguage.detect(path: "bin/tool", firstLine: "hello") == nil)
  }

  @Test func unknownFilesHaveNoLanguage() {
    #expect(SyntaxLanguage.detect(path: "Dockerfile", firstLine: "FROM node") == nil)
    #expect(SyntaxLanguage.detect(path: "image.png", firstLine: nil) == nil)
    #expect(SyntaxLanguage.detect(path: ".gitignore", firstLine: "node_modules") == nil)
  }

  @Test func resolvesLanguageNames() {
    #expect(SyntaxLanguage(languageName: "ts") == .typescript)
    #expect(SyntaxLanguage(languageName: "Swift") == .swift)
    #expect(SyntaxLanguage(languageName: "objective-c") == .objc)
    #expect(SyntaxLanguage(languageName: "shell {1,3}") == .bash)
    #expect(SyntaxLanguage(languageName: "py title=x") == .python)
    #expect(SyntaxLanguage(languageName: "diff") == nil)
    #expect(SyntaxLanguage(languageName: "") == nil)
  }

  @Test func lspIdentifiers() {
    #expect(SyntaxLanguage.tsx.lspLanguageId == "typescriptreact")
    #expect(SyntaxLanguage.objc.lspLanguageId == "objective-c")
    #expect(SyntaxLanguage.bash.lspLanguageId == "shellscript")
    #expect(SyntaxLanguage.swift.lspLanguageId == "swift")
    #expect(SyntaxLanguage.allCases.allSatisfy { $0.telemetryName == $0.rawValue })
  }
}

@Suite struct LimitTests {
  @Test func smallFilesHighlight() {
    #expect(SyntaxLimits.highlightingDisabledReason(byteCount: 100, text: "let x = 1\n") == nil)
  }

  @Test func largeFilesDoNot() {
    #expect(SyntaxLimits.highlightingDisabledReason(byteCount: 2 * 1024 * 1024 + 1, text: "") == .tooLarge)
  }

  @Test func minifiedFilesDoNot() {
    let line = String(repeating: "a", count: 20_001)
    #expect(SyntaxLimits.highlightingDisabledReason(byteCount: 20_001, text: "x\n" + line) == .longLines)
    let ok = String(repeating: "a\n", count: 30_000)
    #expect(SyntaxLimits.highlightingDisabledReason(byteCount: 60_000, text: ok) == nil)
  }
}
