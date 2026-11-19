package dev.houwert.argus.core.code

import dev.houwert.argus.kit.protocol.generated.CodeSymbol
import dev.houwert.argus.kit.protocol.generated.CodeSymbolKind
import kotlin.test.assertEquals
import org.junit.Test

class QuickOpenRankerTest {
  private fun sym(name: String, kind: CodeSymbolKind = CodeSymbolKind.method, path: String = "a.swift", line: Long = 1, container: String? = null) =
    CodeSymbol(name, kind, container, path, line, 0)

  private fun describe(results: List<QuickOpenResult>) = results.map {
    when (it) {
      is QuickOpenResult.File -> "file ${it.path}${if (it.boosted) " *" else ""}"
      is QuickOpenResult.Symbol -> "${it.symbol.kind.rawValue} ${it.symbol.name}${if (it.boosted) " *" else ""}"
    }
  }

  @Test fun aDefinitionBothSourcesKnowIsListedOnceAsTheLanguageServerHasIt() {
    val merged = QuickOpenRanker.merge(
      host = listOf(sym("load", CodeSymbolKind.function, line = 3), sym("save", line = 9)),
      lsp = listOf(sym("load", CodeSymbolKind.method, line = 3, container = "Store")),
    )
    assertEquals(listOf("load", "save"), merged.map { it.name })
    assertEquals(CodeSymbolKind.method, merged[0].kind)
    assertEquals("Store", merged[0].container)
  }

  @Test fun exactNamesBeatPrefixesBeatFuzzyMatchesTypesWinATie() {
    val ranked = QuickOpenRanker.rankSymbols(
      "store", listOf(sym("restore"), sym("storeItems"), sym("store"), sym("Store", CodeSymbolKind.class_), sym("sxtxoxrxe")), emptySet(),
    )
    assertEquals(listOf("class Store", "method store", "method storeItems", "method restore", "method sxtxoxrxe"), describe(ranked))
  }

  @Test fun filesAndSymbolsMixByTheSameTiers() {
    val ranked = QuickOpenRanker.rankMixed(
      "store",
      files = listOf("Sources/Store.swift", "Sources/StoreView.swift", "docs/restore.md", "src/x/store-utils.ts"),
      symbols = listOf(sym("Store", CodeSymbolKind.class_, path = "Sources/Store.swift"), sym("storeHelper", CodeSymbolKind.function, path = "lib.ts")),
      changed = setOf("src/x/store-utils.ts"),
    )
    assertEquals(
      listOf("class Store", "file Sources/Store.swift", "file src/x/store-utils.ts *", "function storeHelper", "file Sources/StoreView.swift", "file docs/restore.md"),
      describe(ranked),
    )
  }

  @Test fun fileSymbolsInOrderByKindWhenGroupedFuzzyOnceTyped() {
    val symbols = listOf(sym("load", line = 3), sym("Store", CodeSymbolKind.class_, line = 1), sym("count", CodeSymbolKind.property, line = 2))
    assertEquals(listOf("method load", "class Store", "property count"), describe(QuickOpenRanker.rankFileSymbols("", symbols, false)))
    assertEquals(listOf("class Store", "method load", "property count"), describe(QuickOpenRanker.rankFileSymbols("", symbols, true)))
    assertEquals(listOf("property count"), describe(QuickOpenRanker.rankFileSymbols("cnt", symbols, false)))
  }
}
