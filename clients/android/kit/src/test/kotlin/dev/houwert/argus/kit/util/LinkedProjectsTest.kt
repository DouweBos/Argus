package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The preamble is a live instruction to the agent and what the desktop parses back into chips: byte for byte. */
class LinkedProjectsTest {
  @Serializable data class Parsed(val paths: List<String>, val rest: String)

  @Serializable data class Fixture(val built: String, val parsed: Parsed)

  private fun fixture(): Fixture =
    Json.decodeFromString(Fixture.serializer(), javaClass.getResource("/linked-projects.json")!!.readText())

  @Test fun buildsTheExactStringTheDesktopBuilds() {
    val built = LinkedProjects.buildPreamble(listOf("~/Work/Argus", "~/Work/Peacock"), "please fix the build")
    assertEquals(fixture().built, built)
  }

  @Test fun parsesTheDesktopsOwnOutput() {
    val f = fixture()
    val parsed = assertNotNull(LinkedProjects.parsePreamble(f.built))
    assertEquals(f.parsed.paths, parsed.paths)
    assertEquals(f.parsed.rest, parsed.rest)
  }

  @Test fun leavesAnOrdinaryMessageAlone() {
    assertEquals("hello", LinkedProjects.buildPreamble(emptyList(), "hello"))
    assertNull(LinkedProjects.parsePreamble("hello"))
  }

  @Test fun aTruncatedPreambleIsNotTreatedAsOne() {
    // No closing bracket means we can't tell where the paths end.
    assertNull(LinkedProjects.parsePreamble(LinkedProjects.HEAD + "\n- ~/Work/Argus"))
  }
}

/** The answer to an AskUserQuestion travels as a deny carrying this exact text: a contract with the desktop. */
class QuestionAnswerTest {
  private val questions = listOf(
    Questions.Question(
      "Which database?", "Database",
      listOf(Questions.Option("Postgres"), Questions.Option("SQLite")), multiSelect = false,
    ),
    Questions.Question(
      "Which features?", "Features",
      listOf(Questions.Option("Auth"), Questions.Option("Billing")), multiSelect = true,
    ),
  )

  @Test fun formatsTheWayTheDesktopFormats() {
    val answer = Questions.formatAnswer(
      questions,
      picks = mapOf(0 to listOf("Postgres"), 1 to listOf("Auth", "Billing", Questions.CUSTOM_KEY)),
      custom = mapOf(1 to "and metrics"),
    )
    assertEquals("The user answered:\n- Database: Postgres\n- Features: Auth, Billing — note: and metrics", answer)
  }

  @Test fun aBareCustomAnswerCarriesNoNotePrefix() {
    val answer = Questions.formatAnswer(
      questions,
      picks = mapOf(0 to listOf(Questions.CUSTOM_KEY), 1 to listOf("Auth")),
      custom = mapOf(0 to "MySQL"),
    )
    assertTrue(answer.contains("- Database: MySQL"))
    assertFalse(answer.contains("note: MySQL"))
  }

  @Test fun roundTripsBackIntoSelections() {
    val answer = Questions.formatAnswer(
      questions,
      picks = mapOf(0 to listOf("SQLite"), 1 to listOf("Billing", Questions.CUSTOM_KEY)),
      custom = mapOf(1 to "plus invoices"),
    )
    val parsed = Questions.parseAnswer(answer, questions)
    assertEquals(listOf("SQLite"), parsed[0]?.picks)
    assertEquals(listOf("Billing"), parsed[1]?.picks)
    assertEquals("plus invoices", parsed[1]?.note)
  }

  @Test fun prefersTheLongestMatchingLabel() {
    val tricky = listOf(
      Questions.Question("Ship it?", null, listOf(Questions.Option("Yes"), Questions.Option("Yes, always")), multiSelect = false),
    )
    val parsed = Questions.parseAnswer("The user answered:\n- Ship it?: Yes, always", tricky)
    assertEquals(listOf("Yes, always"), parsed[0]?.picks)
  }
}
