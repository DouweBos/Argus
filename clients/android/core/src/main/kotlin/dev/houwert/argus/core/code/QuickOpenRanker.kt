package dev.houwert.argus.core.code

import dev.houwert.argus.kit.protocol.generated.CodeSymbol
import dev.houwert.argus.kit.protocol.generated.CodeSymbolKind

/** One row of quick open: a file or a symbol, with the UTF-16 offsets of its matched characters. */
sealed interface QuickOpenResult {
  val id: String
  val path: String

  data class File(override val path: String, val indices: List<Int>, val boosted: Boolean) : QuickOpenResult {
    override val id get() = "f:$path"
  }

  data class Symbol(val symbol: CodeSymbol, val indices: List<Int>, val boosted: Boolean) : QuickOpenResult {
    override val id get() = "s:${symbol.relativePath}:${symbol.line}:${symbol.column}:${symbol.name}"
    override val path get() = symbol.relativePath
  }
}

/**
 * Merges and ranks quick open's sources. Exact names, then prefixes, then fuzzy matches; within
 * each, changed files (and the symbols in them) first, then by fuzzy score; types before members.
 */
object QuickOpenRanker {
  /** The host's index and the language servers' answers as one list, the servers' copy kept when both name it. */
  fun merge(host: List<CodeSymbol>, lsp: List<CodeSymbol>): List<CodeSymbol> {
    val seen = HashSet<String>()
    return (lsp + host).filter { seen.add("${it.relativePath}\u0000${it.line}\u0000${it.name}") }
  }

  fun rankSymbols(query: String, symbols: List<CodeSymbol>, changed: Set<String>, limit: Int = 50): List<QuickOpenResult> =
    sorted(score(query, symbols, changed), limit)

  /** Open Quickly: [files] from the file matcher, ranked together with [symbols]. */
  fun rankMixed(query: String, files: List<String>, symbols: List<CodeSymbol>, changed: Set<String>, limit: Int = 50): List<QuickOpenResult> {
    val needle = query.lowercase()
    val scored = ArrayList<Scored>()
    for (path in files) {
      val (score, indices) = FuzzyFileMatcher.match(query, path) ?: continue
      val name = path.substringAfterLast('/').lowercase()
      val stem = name.substringBeforeLast('.', name)
      val boosted = path in changed
      scored += Scored(maxOf(tier(stem, needle), tier(name, needle)), boosted, score, QuickOpenResult.File(path, indices, boosted))
    }
    return sorted(scored + score(query, symbols, changed), limit)
  }

  /** `@`: the file's symbols in order, or fuzzy-ranked once there's a query. [grouped] sorts by kind. */
  fun rankFileSymbols(query: String, symbols: List<CodeSymbol>, grouped: Boolean): List<QuickOpenResult> {
    if (query.isEmpty()) {
      val ordered = if (grouped) symbols.withIndex().sortedWith(compareBy({ kindOrder(it.value.kind) }, { it.index })).map { it.value } else symbols
      return ordered.map { QuickOpenResult.Symbol(it, emptyList(), false) }
    }
    return rankSymbols(query, symbols, emptySet(), 200)
  }

  private fun score(query: String, symbols: List<CodeSymbol>, changed: Set<String>): List<Scored> {
    val needle = query.lowercase()
    return symbols.mapNotNull { symbol ->
      val (score, indices) = FuzzyFileMatcher.match(query, symbol.name) ?: return@mapNotNull null
      val boosted = symbol.relativePath in changed
      Scored(tier(symbol.name.lowercase(), needle), boosted, score + kindBonus(symbol.kind) * 16, QuickOpenResult.Symbol(symbol, indices, boosted))
    }
  }

  private data class Scored(val tier: Int, val boosted: Boolean, val score: Long, val result: QuickOpenResult)

  private fun sorted(scored: List<Scored>, limit: Int): List<QuickOpenResult> =
    scored.sortedWith(compareByDescending<Scored> { it.tier }.thenByDescending { it.boosted }.thenByDescending { it.score })
      .take(limit).map { it.result }

  /** 3: the whole name, 2: its start, 1: anywhere. */
  private fun tier(name: String, needle: String): Int = when {
    name == needle -> 3
    name.startsWith(needle) -> 2
    else -> 1
  }

  private fun kindBonus(kind: CodeSymbolKind): Int = when (kind) {
    CodeSymbolKind.class_, CodeSymbolKind.struct, CodeSymbolKind.enum, CodeSymbolKind.interface_, CodeSymbolKind.protocol, CodeSymbolKind.typeAlias -> 2
    CodeSymbolKind.function, CodeSymbolKind.method -> 1
    else -> 0
  }

  private val kindOrderList = with(CodeSymbolKind) {
    listOf(class_, struct, enum, protocol, interface_, extension, typeAlias, module, constructor, method, function, property, constant, variable, enumMember, other)
  }

  private fun kindOrder(kind: CodeSymbolKind): Int = kindOrderList.indexOf(kind).let { if (it < 0) kindOrderList.size else it }
}
