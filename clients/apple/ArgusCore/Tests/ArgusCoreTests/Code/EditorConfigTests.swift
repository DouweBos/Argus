import Foundation
import Testing

@testable import ArgusCore

@Suite("EditorConfig")
struct EditorConfigTests {
  let root = """
    # top-most
    root = true

    [*]
    indent_style = space
    indent_size = 2
    end_of_line = lf
    insert_final_newline = true
    trim_trailing_whitespace = true

    [*.{swift,kt}]
    indent_size = 4

    [Makefile]
    indent_style = tab

    [*.md]
    trim_trailing_whitespace = false

    [docs/**.txt]
    indent_size = 8

    [lib/[abc]*.js]
    indent_size = 3
    """

  @Test("parses root, sections and properties")
  func parses() {
    let config = EditorConfig(parsing: root)
    #expect(config.isRoot)
    #expect(config.sections.map(\.glob) == ["*", "*.{swift,kt}", "Makefile", "*.md", "docs/**.txt", "lib/[abc]*.js"])
    #expect(config.sections[0].properties["indent_style"] == "space")
  }

  @Test("later sections override earlier ones")
  func sections() {
    let files = [(directory: "", text: root)]
    let swift = EditorConfig.resolve(path: "Sources/App/Foo.swift", files: files)
    #expect(swift == .init(indentStyle: .space, indentSize: 4, tabWidth: 4, endOfLine: .lf, insertFinalNewline: true, trimTrailingWhitespace: true))
    #expect(EditorConfig.resolve(path: "a/b/Makefile", files: files).indentStyle == .tab)
    #expect(EditorConfig.resolve(path: "README.md", files: files).trimTrailingWhitespace == false)
    #expect(EditorConfig.resolve(path: "docs/deep/x/notes.txt", files: files).indentSize == 8)
    #expect(EditorConfig.resolve(path: "other/docs/notes.txt", files: files).indentSize == 2)
    #expect(EditorConfig.resolve(path: "lib/b2.js", files: files).indentSize == 3)
    #expect(EditorConfig.resolve(path: "lib/d2.js", files: files).indentSize == 2)
  }

  @Test("nearer files win; root = true stops the walk")
  func nesting() {
    let nested = "[*.ts]\nindent_size = 4\n"
    let isolated = "root = true\n[*]\nindent_style = tab\n"
    let files = [
      (directory: "packages/host", text: nested),
      (directory: "", text: root),
    ]
    let host = EditorConfig.resolve(path: "packages/host/src/x.ts", files: files)
    #expect(host.indentSize == 4)
    #expect(host.endOfLine == .lf)
    #expect(EditorConfig.resolve(path: "app/x.ts", files: files).indentSize == 2)
    let stopped = EditorConfig.resolve(
      path: "vendor/x.ts", files: [(directory: "vendor", text: isolated), (directory: "", text: root)])
    #expect(stopped == .init(indentStyle: .tab))
  }

  @Test("indent_size = tab and unset")
  func specialValues() {
    let text = "[*]\nindent_style = tab\nindent_size = tab\ntab_width = 8\n[*.go]\ntab_width = unset\n"
    let props = EditorConfig.resolve(path: "a.c", files: [(directory: "", text: text)])
    #expect(props.indentSize == 8)
    #expect(props.tabWidth == 8)
    let go = EditorConfig.resolve(path: "a.go", files: [(directory: "", text: text)])
    #expect(go.tabWidth == nil)
  }

  @Test("glob translation", arguments: [
    ("*.js", "a/b/c.js", true), ("*.js", "c.ts", false), ("/src/*.js", "src/a.js", true),
    ("/src/*.js", "src/x/a.js", false), ("src/**/*.js", "src/x/y/a.js", true), ("src/**/*.js", "src/a.js", true),
    ("{a,b}.txt", "b.txt", true), ("{a,b}.txt", "c.txt", false), ("file{1..3}.c", "file2.c", true),
    ("file{1..3}.c", "file4.c", false), ("[!a]*.md", "b.md", true), ("[!a]*.md", "a.md", false),
    ("?.py", "x.py", true), ("?.py", "xy.py", false),
  ])
  func globs(glob: String, path: String, expected: Bool) {
    #expect(EditorConfigGlob.matches(glob, path: path) == expected)
  }
}
