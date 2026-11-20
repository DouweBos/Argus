package dev.houwert.argus.ui.syntax

import java.util.regex.Pattern

/**
 * Colours source with one combined regex per language: comments, strings, numbers and identifiers,
 * with identifiers sorted into keywords, types, functions and constants. Not a parser (the Mac uses
 * tree-sitter), but it reads the same at a glance and handles multi-line comments and strings.
 */
object SyntaxHighlighter {
  fun highlight(text: String, language: SyntaxLanguage): List<SyntaxRun> {
    val grammar = grammars.getOrPut(language) { Grammar.of(language) }
    val runs = ArrayList<SyntaxRun>()
    val matcher = grammar.pattern.matcher(text)
    while (matcher.find()) {
      for ((group, kind) in grammar.groups.withIndex()) {
        val start = matcher.start(group + 1)
        if (start < 0) continue
        val end = matcher.end(group + 1)
        val capture = when (kind) {
          Kind.Identifier -> grammar.classify(text, start, end)
          is Kind.Fixed -> kind.capture
        } ?: break
        if (end > start) runs += SyntaxRun(start, end, capture)
        break
      }
    }
    return runs
  }

  private val grammars = java.util.concurrent.ConcurrentHashMap<SyntaxLanguage, Grammar>()

  private sealed interface Kind {
    data object Identifier : Kind
    data class Fixed(val capture: SyntaxCapture) : Kind
  }

  private class Grammar(rules: List<Pair<String, Kind>>, val keywords: Set<String>, val constants: Set<String>, val typesByCase: Boolean) {
    val groups = rules.map { it.second }
    val pattern: Pattern = Pattern.compile(rules.joinToString("|") { "(${it.first})" }, Pattern.MULTILINE)

    fun classify(text: String, start: Int, end: Int): SyntaxCapture? {
      val word = text.substring(start, end)
      if (word in keywords) return SyntaxCapture.Keyword
      if (word in constants) return SyntaxCapture.Constant
      var next = end
      while (next < text.length && text[next] == ' ') next++
      if (next < text.length && text[next] == '(') return SyntaxCapture.Function
      if (typesByCase && word[0].isUpperCase()) {
        return if (word.length > 1 && word.all { it.isUpperCase() || it.isDigit() || it == '_' }) SyntaxCapture.Constant else SyntaxCapture.Type
      }
      if (start > 0 && text[start - 1] == '.') return SyntaxCapture.Property
      return null
    }

    companion object {
      private val ident = Kind.Identifier
      private fun f(capture: SyntaxCapture) = Kind.Fixed(capture)
      private const val NUMBER = """\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z]*\b"""
      private const val DQ = """"(?:[^"\\\n]|\\.)*""""
      private const val SQ = """'(?:[^'\\\n]|\\.)*'"""
      private const val BLOCK = """/\*[\s\S]*?(?:\*/|\z)"""
      private const val LINE = """//[^\n]*"""
      private const val HASH = """#[^\n]*"""
      private const val WORD = """[A-Za-z_$][A-Za-z0-9_$]*"""
      private const val OPS = """[+\-*/%=<>!&|^~?:]+"""

      private fun words(s: String) = s.split(' ').filter { it.isNotEmpty() }.toSet()

      private fun cLike(keywords: String, extraStrings: List<String> = emptyList(), annotations: Boolean = true, constants: String = "true false null nil") = Grammar(
        listOf(BLOCK to f(SyntaxCapture.Comment), LINE to f(SyntaxCapture.Comment)) +
          extraStrings.map { it to f(SyntaxCapture.String) } +
          listOf(DQ to f(SyntaxCapture.String), SQ to f(SyntaxCapture.String), NUMBER to f(SyntaxCapture.Number)) +
          (if (annotations) listOf("""[@#]$WORD""" to f(SyntaxCapture.Attribute)) else emptyList()) +
          listOf(WORD to ident, OPS to f(SyntaxCapture.Operator)),
        words(keywords), words(constants), typesByCase = true,
      )

      private fun hashLang(keywords: String, constants: String, extraStrings: List<String> = emptyList(), typesByCase: Boolean = true) = Grammar(
        extraStrings.map { it to f(SyntaxCapture.String) } + listOf(
          HASH to f(SyntaxCapture.Comment), DQ to f(SyntaxCapture.String), SQ to f(SyntaxCapture.String),
          NUMBER to f(SyntaxCapture.Number), """\$\{?[A-Za-z_][A-Za-z0-9_]*\}?""" to f(SyntaxCapture.Property),
          """@[A-Za-z_][A-Za-z0-9_.]*""" to f(SyntaxCapture.Attribute), "[A-Za-z_][A-Za-z0-9_]*[?!]?" to ident,
          OPS to f(SyntaxCapture.Operator),
        ),
        words(keywords), words(constants), typesByCase,
      )

      private const val JS = "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface keyof let namespace new of private protected public readonly return satisfies set static super switch this throw try type typeof var void while with yield"
      private const val TEMPLATE = """`(?:[^`\\]|\\.)*`"""

      fun of(language: SyntaxLanguage): Grammar = when (language) {
        SyntaxLanguage.Swift -> cLike(
          "actor any as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough fileprivate final for func guard if import in init inout internal is let mutating nonisolated open operator override private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws try typealias var weak where while",
          listOf("\"\"\"[\\s\\S]*?(?:\"\"\"|\\z)"),
        )
        SyntaxLanguage.Kotlin -> cLike(
          "abstract as break by catch class companion const constructor continue data do else enum external false final for fun get if import in infix init inline interface internal is lateinit object open operator out override package private protected public reified return sealed set super suspend this throw try typealias val var vararg when where while",
          listOf("\"\"\"[\\s\\S]*?(?:\"\"\"|\\z)"),
        )
        SyntaxLanguage.Java -> cLike("abstract assert break case catch class const continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public record return static super switch synchronized this throw throws transient try var void volatile while")
        SyntaxLanguage.TypeScript, SyntaxLanguage.Tsx, SyntaxLanguage.JavaScript -> cLike(JS, listOf(TEMPLATE), constants = "true false null undefined NaN Infinity")
        SyntaxLanguage.Go -> cLike("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var", listOf(TEMPLATE), annotations = false, constants = "true false nil iota")
        SyntaxLanguage.Rust -> cLike("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while", constants = "true false None Some Ok Err")
        SyntaxLanguage.ObjC -> cLike("auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while self super id instancetype nonatomic strong weak copy assign readonly readwrite", constants = "YES NO nil NULL true false")
        SyntaxLanguage.Python -> hashLang(
          "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self",
          "True False None", listOf("(?:\"\"\"[\\s\\S]*?(?:\"\"\"|\\z))|(?:'''[\\s\\S]*?(?:'''|\\z))"),
        )
        SyntaxLanguage.Ruby -> hashLang("alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require attr_reader attr_accessor", "true false nil")
        SyntaxLanguage.Bash -> hashLang("if then else elif fi for in do done while until case esac function return local export readonly declare set unset shift exit echo source", "true false", typesByCase = false)
        SyntaxLanguage.Yaml -> Grammar(
          listOf(
            HASH to f(SyntaxCapture.Comment), DQ to f(SyntaxCapture.String), SQ to f(SyntaxCapture.String),
            """^[ \t]*-?[ \t]*[A-Za-z0-9_.\-/"']+(?=[ \t]*:(?:\s|$))""" to f(SyntaxCapture.Property),
            """[&*][A-Za-z0-9_-]+""" to f(SyntaxCapture.Attribute), NUMBER to f(SyntaxCapture.Number),
            "[A-Za-z_][A-Za-z0-9_]*" to ident,
          ),
          emptySet(), words("true false null yes no on off"), typesByCase = false,
        )
        SyntaxLanguage.Json -> Grammar(
          listOf(
            LINE to f(SyntaxCapture.Comment), BLOCK to f(SyntaxCapture.Comment),
            "$DQ(?=\\s*:)" to f(SyntaxCapture.Property), DQ to f(SyntaxCapture.String),
            "-?$NUMBER" to f(SyntaxCapture.Number), "[A-Za-z_]+" to ident,
          ),
          emptySet(), words("true false null"), typesByCase = false,
        )
        SyntaxLanguage.Css -> Grammar(
          listOf(
            BLOCK to f(SyntaxCapture.Comment), DQ to f(SyntaxCapture.String), SQ to f(SyntaxCapture.String),
            """[a-zA-Z-]+(?=\s*:[^;{]*;)""" to f(SyntaxCapture.Property), """#[0-9a-fA-F]{3,8}\b""" to f(SyntaxCapture.Constant),
            """-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?""" to f(SyntaxCapture.Number),
            """@[a-zA-Z-]+""" to f(SyntaxCapture.Keyword), """[.#][a-zA-Z_-][\w-]*""" to f(SyntaxCapture.Type),
            "[a-zA-Z_-][\\w-]*" to ident,
          ),
          words("important inherit initial unset"), emptySet(), typesByCase = false,
        )
        SyntaxLanguage.Html -> Grammar(
          listOf(
            """<!--[\s\S]*?(?:-->|\z)""" to f(SyntaxCapture.Comment), """</?[A-Za-z][A-Za-z0-9-]*""" to f(SyntaxCapture.Tag),
            """/?>""" to f(SyntaxCapture.Tag), DQ to f(SyntaxCapture.String), SQ to f(SyntaxCapture.String),
            """[A-Za-z_:][A-Za-z0-9_:.-]*(?==)""" to f(SyntaxCapture.Attribute), """&[A-Za-z#0-9]+;""" to f(SyntaxCapture.Escape),
          ),
          emptySet(), emptySet(), typesByCase = false,
        )
        SyntaxLanguage.Markdown -> Grammar(
          listOf(
            """^#{1,6}[ \t][^\n]*""" to f(SyntaxCapture.Heading), """^```[\s\S]*?(?:^```|\z)""" to f(SyntaxCapture.Code),
            """`[^`\n]+`""" to f(SyntaxCapture.Code), """\[[^\]\n]*\]\([^)\n]*\)""" to f(SyntaxCapture.Link),
            """\*\*[^*\n]+\*\*|__[^_\n]+__""" to f(SyntaxCapture.Strong), """\*[^*\n]+\*|_[^_\n]+_""" to f(SyntaxCapture.Emphasis),
            """^[ \t]*(?:[-*+]|\d+\.)[ \t]""" to f(SyntaxCapture.Punctuation), """^>[^\n]*""" to f(SyntaxCapture.Comment),
          ),
          emptySet(), emptySet(), typesByCase = false,
        )
      }
    }
  }
}
