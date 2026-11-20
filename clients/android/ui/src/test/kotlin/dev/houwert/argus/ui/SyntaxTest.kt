package dev.houwert.argus.ui

import dev.houwert.argus.ui.syntax.CodeHighlighting
import dev.houwert.argus.ui.syntax.SyntaxCapture
import dev.houwert.argus.ui.syntax.SyntaxHighlighter
import dev.houwert.argus.ui.syntax.SyntaxLanguage
import dev.houwert.argus.ui.syntax.SyntaxLanguage.*
import dev.houwert.argus.ui.syntax.SyntaxLimits
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyntaxTest {
  @Test fun detectsByPath() {
    val cases = listOf(
      "Sources/App/Foo.swift" to Swift, "a/b.ts" to TypeScript, "x.mts" to TypeScript, "View.tsx" to Tsx,
      "index.js" to JavaScript, "Comp.jsx" to JavaScript, "lib.mjs" to JavaScript, "package.json" to Json,
      "Package.resolved" to Json, "README.md" to Markdown, "Main.kt" to Kotlin, "build.gradle.kts" to Kotlin,
      "App.java" to Java, "AppDelegate.m" to ObjC, "Bridge.mm" to ObjC, "Header.h" to ObjC, "ci.yml" to Yaml,
      "x.yaml" to Yaml, "run.sh" to Bash, ".zshrc" to Bash, "site.css" to Css, "index.html" to Html,
      "tool.py" to Python, "Podfile" to Ruby, "Gemfile" to Ruby, "fastlane/Fastfile" to Ruby, "x.rb" to Ruby,
      "main.go" to Go, "lib.rs" to Rust, "FOO.SWIFT" to Swift,
    )
    for ((path, expected) in cases) assertEquals(path, expected, SyntaxLanguage.detect(path, null))
  }

  @Test fun detectsByShebang() {
    assertEquals(Python, SyntaxLanguage.detect("bin/tool", "#!/usr/bin/env python3"))
    assertEquals(Bash, SyntaxLanguage.detect("bin/tool", "#!/bin/bash -e"))
    assertEquals(JavaScript, SyntaxLanguage.detect("bin/tool", "#!/usr/bin/env -S node --no-warnings"))
    assertEquals(Ruby, SyntaxLanguage.detect("bin/tool", "#!/usr/bin/ruby"))
    assertNull(SyntaxLanguage.detect("bin/tool", "hello"))
    assertNull(SyntaxLanguage.detect("Dockerfile", "FROM node"))
    assertNull(SyntaxLanguage.detect("image.png", null))
    assertNull(SyntaxLanguage.detect(".gitignore", "node_modules"))
  }

  @Test fun resolvesLooseNames() {
    assertEquals(TypeScript, SyntaxLanguage.fromName("ts"))
    assertEquals(Swift, SyntaxLanguage.fromName("Swift"))
    assertEquals(ObjC, SyntaxLanguage.fromName("objective-c"))
    assertEquals(Bash, SyntaxLanguage.fromName("shell {1,3}"))
    assertEquals(Python, SyntaxLanguage.fromName("py title=x"))
    assertNull(SyntaxLanguage.fromName("diff"))
    assertNull(SyntaxLanguage.fromName(""))
  }

  @Test fun limits() {
    assertNull(SyntaxLimits.highlightingDisabledReason(100, "let x = 1\n"))
    assertEquals(SyntaxLimits.DisabledReason.TooLarge, SyntaxLimits.highlightingDisabledReason(2 * 1024 * 1024 + 1, ""))
    assertEquals(SyntaxLimits.DisabledReason.LongLines, SyntaxLimits.highlightingDisabledReason(20_001, "x\n" + "a".repeat(20_001)))
  }

  private fun captured(text: String, language: SyntaxLanguage) =
    SyntaxHighlighter.highlight(text, language).map { text.substring(it.start, it.end) to it.capture }

  @Test fun coloursKeywordsStringsCommentsAndTypes() {
    val runs = captured("/// A greeting.\nstruct Greeter {\n  let name = \"hi\" // ok\n  func greet() -> Int { 42 }\n}", Swift)
    assertTrue(("/// A greeting." to SyntaxCapture.Comment) in runs)
    assertTrue(("struct" to SyntaxCapture.Keyword) in runs)
    assertTrue(("Greeter" to SyntaxCapture.Type) in runs)
    assertTrue(("\"hi\"" to SyntaxCapture.String) in runs)
    assertTrue(("greet" to SyntaxCapture.Function) in runs)
    assertTrue(("42" to SyntaxCapture.Number) in runs)
  }

  @Test fun jsonKeysAreProperties() {
    val runs = captured("""{"a": "b", "n": 1, "t": true}""", Json)
    assertTrue(("\"a\"" to SyntaxCapture.Property) in runs)
    assertTrue(("\"b\"" to SyntaxCapture.String) in runs)
    assertTrue(("true" to SyntaxCapture.Constant) in runs)
  }

  @Test fun aBlockCommentSpanningLinesColoursEachLine() {
    val text = "a /* one\ntwo */ b"
    val runs = SyntaxHighlighter.highlight(text, Kotlin)
    val lines = CodeHighlighting.annotatedLines(text, runs, dev.houwert.argus.ui.theme.SyntaxPalette.Dark)
    assertEquals(listOf("a /* one", "two */ b"), lines.map { it.text })
    assertEquals(1, lines[1].spanStyles.size)
    assertEquals(0, lines[1].spanStyles[0].start)
  }
}
