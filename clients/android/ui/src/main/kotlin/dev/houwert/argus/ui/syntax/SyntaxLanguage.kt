package dev.houwert.argus.ui.syntax

/** A language Argus can highlight; twin of ArgusSyntax's `SyntaxLanguage`. */
enum class SyntaxLanguage(val displayName: String) {
  Swift("Swift"), TypeScript("TypeScript"), Tsx("TSX"), JavaScript("JavaScript"), Json("JSON"), Markdown("Markdown"),
  Kotlin("Kotlin"), Java("Java"), ObjC("Objective-C"), Yaml("YAML"), Bash("Shell"), Css("CSS"), Html("HTML"),
  Python("Python"), Ruby("Ruby"), Go("Go"), Rust("Rust");

  /** The `language` value telemetry events carry; never a path or file name. */
  val telemetryName: String get() = when (this) {
    TypeScript -> "typescript"
    ObjC -> "objc"
    else -> name.lowercase()
  }

  companion object {
    /** From a file path (extension or well-known file name) and, failing that, a `#!` shebang. */
    fun detect(path: String, firstLine: String?): SyntaxLanguage? {
      val name = path.substringAfterLast('/')
      fileNames[name]?.let { return it }
      val lower = name.lowercase()
      fileNames[lower]?.let { return it }
      val ext = lower.substringAfterLast('.', "")
      if (ext.isNotEmpty() && lower != ".$ext") extensions[ext]?.let { return it }
      return firstLine?.let(::fromShebang)
    }

    /** A loose language name, such as a Markdown fence info string (`ts`, `shell {1,3}`). */
    fun fromName(languageName: String): SyntaxLanguage? {
      val token = languageName.trim().split(' ', '{', ',', ':').firstOrNull()?.lowercase().orEmpty()
      if (token.isEmpty()) return null
      return aliases[token] ?: entries.firstOrNull { it.telemetryName == token } ?: extensions[token]
    }

    private fun fromShebang(line: String): SyntaxLanguage? {
      if (!line.startsWith("#!")) return null
      val parts = line.drop(2).split(' ').filter { it.isNotEmpty() }
      var interpreter = parts.firstOrNull()?.substringAfterLast('/') ?: return null
      if (interpreter == "env") interpreter = parts.drop(1).firstOrNull { !it.startsWith("-") } ?: return null
      return shebangs[interpreter.trimEnd { it.isDigit() || it == '.' }]
    }

    private val extensions = mapOf(
      "swift" to Swift, "ts" to TypeScript, "mts" to TypeScript, "cts" to TypeScript, "tsx" to Tsx,
      "js" to JavaScript, "mjs" to JavaScript, "cjs" to JavaScript, "jsx" to JavaScript,
      "json" to Json, "jsonc" to Json, "json5" to Json, "resolved" to Json, "webmanifest" to Json,
      "md" to Markdown, "markdown" to Markdown, "mdown" to Markdown, "mkd" to Markdown,
      "kt" to Kotlin, "kts" to Kotlin, "java" to Java, "m" to ObjC, "mm" to ObjC, "h" to ObjC,
      "yaml" to Yaml, "yml" to Yaml, "sh" to Bash, "bash" to Bash, "zsh" to Bash, "command" to Bash,
      "css" to Css, "html" to Html, "htm" to Html, "xhtml" to Html,
      "py" to Python, "pyi" to Python, "pyw" to Python,
      "rb" to Ruby, "rake" to Ruby, "gemspec" to Ruby, "podspec" to Ruby, "ru" to Ruby, "go" to Go, "rs" to Rust,
    )

    private val fileNames = mapOf(
      "Podfile" to Ruby, "Gemfile" to Ruby, "Rakefile" to Ruby, "Fastfile" to Ruby, "Appfile" to Ruby,
      "Matchfile" to Ruby, "Pluginfile" to Ruby, "Dangerfile" to Ruby, "Brewfile" to Ruby, "Snapfile" to Ruby,
      "Scanfile" to Ruby, "Gymfile" to Ruby,
      ".bashrc" to Bash, ".bash_profile" to Bash, ".zshrc" to Bash, ".zprofile" to Bash, ".profile" to Bash, ".envrc" to Bash,
      ".babelrc" to Json, ".eslintrc" to Json, ".prettierrc" to Json, ".swcrc" to Json,
    )

    private val shebangs = mapOf(
      "node" to JavaScript, "bun" to JavaScript, "deno" to TypeScript, "ts-node" to TypeScript, "tsx" to TypeScript,
      "python" to Python, "ruby" to Ruby, "bash" to Bash, "sh" to Bash, "zsh" to Bash, "dash" to Bash, "ksh" to Bash,
      "swift" to Swift,
    )

    private val aliases = mapOf(
      "typescript" to TypeScript, "javascript" to JavaScript, "node" to JavaScript, "jsonc" to Json, "json5" to Json,
      "kotlin" to Kotlin, "objective-c" to ObjC, "objectivec" to ObjC, "obj-c" to ObjC, "objc" to ObjC, "c" to ObjC,
      "shell" to Bash, "shellscript" to Bash, "console" to Bash, "sh" to Bash, "zsh" to Bash, "python3" to Python,
      "golang" to Go, "md" to Markdown,
    )
  }
}

/** The Argus highlight vocabulary; every theme draws one colour per case. */
enum class SyntaxCapture {
  Keyword, String, Comment, Type, Function, Number, Constant, Variable, Property, Operator, Punctuation, Tag,
  Attribute, Escape, Regex, Heading, Link, Emphasis, Strong, Code,
}

/** A styled span of a document, in UTF-16 offsets. */
data class SyntaxRun(val start: Int, val end: Int, val capture: SyntaxCapture)

/** Size guards: minified bundles and huge files open with highlighting off. */
object SyntaxLimits {
  enum class DisabledReason { TooLarge, LongLines }

  const val MAX_BYTES = 2 * 1024 * 1024
  const val MAX_LINE_LENGTH = 20_000

  fun highlightingDisabledReason(byteCount: Int, text: String): DisabledReason? {
    if (byteCount > MAX_BYTES) return DisabledReason.TooLarge
    var length = 0
    for (c in text) {
      if (c == '\n') length = 0 else if (++length > MAX_LINE_LENGTH) return DisabledReason.LongLines
    }
    return null
  }
}
