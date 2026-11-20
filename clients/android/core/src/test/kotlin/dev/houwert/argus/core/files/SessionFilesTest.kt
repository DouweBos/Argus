package dev.houwert.argus.core.files

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.readFile
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.decode
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.CodeSearchEvent
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Test

class SessionFilePathsTest {
  private val files = listOf("src/a.ts", "pkg/src/a.ts", "README.md")

  @Test fun relativePathsAreNormalisedWithoutTheFileList() {
    assertEquals("src/a.ts", SessionFilePaths.relative("./src/../src/a.ts", emptyList()))
    assertNull(SessionFilePaths.relative("../outside.ts", emptyList()))
    assertFalse(SessionFilePaths.needsFileList("src/a.ts"))
  }

  @Test fun absolutePathsMatchTheLongestSessionFileBySuffix() {
    assertTrue(SessionFilePaths.needsFileList("/Users/me/wt/pkg/src/a.ts"))
    assertEquals("pkg/src/a.ts", SessionFilePaths.relative("/Users/me/wt/pkg/src/a.ts", files))
    assertEquals("README.md", SessionFilePaths.relative("~/wt/README.md", files))
    assertNull(SessionFilePaths.relative("/etc/hosts", files))
  }

  @Test fun splitsNameAndDirectory() {
    assertEquals("a.ts", SessionFilePaths.fileName("pkg/src/a.ts"))
    assertEquals("pkg/src", SessionFilePaths.directory("pkg/src/a.ts"))
    assertEquals("", SessionFilePaths.directory("a.ts"))
  }
}

class HostStoreFilesTest {
  private fun matches(id: String, paths: List<String>): String {
    val items = paths.mapIndexed { i, p -> """{"relativePath":"$p","line":${i + 1},"column":0,"length":3,"preview":"foo","previewOffset":0}""" }
    return """{"kind":"matches","searchId":"$id","matches":[${items.joinToString(",")}]}"""
  }

  @Test fun readsAFileBySessionRelativePath() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.FilesRead, """{"content":"hi","hash":"x","mtimeMs":1,"size":2,"eol":"lf"}""")
    attach(store, backend)
    assertEquals("hi", store.readFile("s1", "a.ts").content)
    assertEquals("s1", backend.params(Methods.FilesRead)?.string("session_id"))
    assertEquals("a.ts", backend.params(Methods.FilesRead)?.string("path"))
  }

  @Test fun streamsMatchesGroupedByFileThenFinishes() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.FilesSearch, """{"search_id":"x"}""")
    attach(store, backend)
    val search = FileSearchStore(store, "s1")
    var finished: Int? = null
    search.onFinished = { _, count, _ -> finished = count }

    search.run(FileSearchQuery("foo", regex = true))
    assertEquals(FileSearchStore.Phase.Running, search.phase.value)
    val id = (backend.calls(Methods.FilesSearch.name).first().params as JsonObject).string("search_id")!!
    assertEquals("code-search:$id" to true, backend.subscriptions.first())

    backend.emit("files.search", payload = matches(id, listOf("a.ts", "b.ts", "a.ts")))
    backend.emit("files.search", payload = """{"kind":"done","searchId":"$id","count":3,"truncated":false,"cancelled":false}""")
    settle()
    assertEquals(FileSearchStore.Phase.Done(3, false), search.phase.value)
    assertEquals(listOf("a.ts", "b.ts"), search.groups.value.map { it.path })
    assertEquals(2, search.groups.value.first().matches.size)
    assertEquals(3, finished)
    assertEquals("code-search:$id" to false, backend.subscriptions.last())
  }

  @Test fun aNewQueryCancelsTheLastAndIgnoresItsStragglers() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.FilesSearch, """{"search_id":"x"}""")
    backend.reply(Methods.FilesSearchCancel, """{"accepted":true}""")
    attach(store, backend)
    val search = FileSearchStore(store, "s1")

    search.run(FileSearchQuery("one"))
    val first = (backend.calls(Methods.FilesSearch.name).first().params as JsonObject).string("search_id")!!
    search.run(FileSearchQuery("two"))
    assertEquals(1, backend.count(Methods.FilesSearchCancel))
    backend.emit("files.search", payload = matches(first, listOf("stale.ts")))
    settle()
    assertTrue(search.groups.value.isEmpty())
    assertEquals(FileSearchStore.Phase.Running, search.phase.value)
  }

  @Test fun scheduleDebouncesToTheLastQuery() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.FilesSearch, """{"search_id":"x"}""")
    attach(store, backend)
    val search = FileSearchStore(store, "s1")
    search.schedule(FileSearchQuery("f"))
    search.schedule(FileSearchQuery("fo"))
    settle()
    val calls = backend.calls(Methods.FilesSearch.name)
    assertEquals(1, calls.size)
    assertEquals("fo", (calls.first().params as JsonObject).string("query"))
  }

  @Test fun shownReferencesSurviveTheirOwnTitleBeingScheduled() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    val search = FileSearchStore(store, "s1")
    val event = decode(CodeSearchEvent.serializer(), matches("r", listOf("a.ts", "a.ts"))) as CodeSearchEvent.Matches

    search.show(event.value.matches, "foo")
    search.schedule(FileSearchQuery("foo"))
    settle()
    assertEquals(0, backend.count(Methods.FilesSearch))
    assertEquals(FileSearchStore.Phase.Done(2, false), search.phase.value)
    assertEquals(listOf("a.ts"), search.groups.value.map { it.path })
  }
}
