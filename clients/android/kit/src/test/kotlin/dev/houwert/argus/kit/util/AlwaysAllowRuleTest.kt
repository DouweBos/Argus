package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals

class AlwaysAllowRuleTest {
  @Test fun mirrorsTheRenderersRules() {
    val cases = listOf(
      Triple("Bash", mapOf("command" to str("  npm run test --watch")), "Bash(npm *)"),
      Triple("Bash", mapOf("command" to str("")), "Bash"),
      Triple("Edit", mapOf("file_path" to str("/repo/src/App.tsx")), "Edit(**/*.tsx)"),
      Triple("Write", mapOf("file_path" to str("/repo/Makefile")), "Write"),
      Triple("Read", mapOf("file_path" to str("/repo/.config/rc")), "Read"),
      Triple("Read", mapOf("path" to str("notes.md")), "Read(**/*.md)"),
      Triple("WebFetch", mapOf("url" to str("https://docs.swift.org/x")), "WebFetch(domain:docs.swift.org)"),
      Triple("WebFetch", mapOf("url" to str("not a url")), "WebFetch"),
      Triple("Glob", emptyMap(), "Glob"),
    )
    for ((name, input, expected) in cases) assertEquals(expected, AlwaysAllowRule.rule(name, input), "$name $input")
  }
}
