package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlockImage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ToolGroupsTest {
  private fun msg(id: String, text: List<String> = emptyList(), tools: List<String> = emptyList()) =
    message(id, text = text, toolCalls = tools.mapIndexed { i, name -> toolCall("$id-$i", name) })

  private fun user(id: String) = message(id, RemoteMessageRole.user, text = listOf("do it"))

  private fun pending(id: String) =
    message(id, toolCalls = listOf(toolCall("$id-0", "Bash", status = RemoteToolCallStatus.pending)))

  @Test fun turnsFoldWorkAndKeepTheOpeningAndClosingReplies() {
    val segments = ToolGroups.groupTurns(
      listOf(
        user("u"), msg("1", text = listOf("Short answer: yes. Let me look")), msg("2", tools = listOf("Read")),
        msg("n", text = listOf("Now the edit")), msg("3", tools = listOf("Edit")), msg("r", text = listOf("Done")),
      ),
    )
    assertEquals(listOf("u", "1", "group-2", "r"), segments.map { it.id })
    val work = assertIs<ToolGroups.Segment.Collapsed>(segments[2])
    assertEquals(listOf("2", "n", "3"), work.messages.map { it.id })
  }

  @Test fun turnsLeaveTextOnlyTurnsAlone() {
    val segments = ToolGroups.groupTurns(listOf(user("u"), msg("1", text = listOf("Hi")), msg("2", text = listOf("There"))))
    assertEquals(listOf("u", "1", "2"), segments.map { it.id })
  }

  @Test fun turnsKeepErrorsAndDecisionsOpen() {
    val error = message("e", text = listOf("boom"), isError = true)
    val segments = ToolGroups.groupTurns(
      listOf(user("u"), msg("1", tools = listOf("Read")), error, msg("2", tools = listOf("Bash")), pending("p")),
    )
    assertEquals(listOf("u", "group-1", "e", "group-2", "p"), segments.map { it.id })
  }

  @Test fun turnsFoldARunningTurnWhole() {
    val segments = ToolGroups.groupTurns(
      listOf(user("u"), msg("1", tools = listOf("Read")), user("v"), msg("2", text = listOf("Ok")), msg("3", tools = listOf("Bash"))),
    )
    assertEquals(listOf("u", "group-1", "v", "2", "group-3"), segments.map { it.id })
  }

  @Test fun dropsMessagesWithNothingToShow() {
    assertEquals(listOf("a"), ToolGroups.group(listOf(msg("a", text = listOf("hi")), msg("b", text = listOf("  ")))).map { it.id })
  }

  @Test fun neverFoldsACallAwaitingApproval() {
    val segments = ToolGroups.group(
      listOf(msg("1", tools = listOf("Bash")), pending("2"), msg("3", tools = listOf("Bash")), msg("4", tools = listOf("Bash"))),
    )
    assertEquals(listOf("1", "2", "group-3"), segments.map { it.id })
  }

  @Test fun foldsAPairButLeavesALoneCall() {
    val segments = ToolGroups.group(
      listOf(msg("1", tools = listOf("Bash")), msg("2", tools = listOf("Read")), msg("t", text = listOf("done")), msg("3", tools = listOf("Bash"))),
    )
    assertEquals(listOf("group-1", "t", "3"), segments.map { it.id })
  }

  @Test fun neverFoldsAPushNotification() {
    val segments = ToolGroups.group(
      listOf(msg("1", tools = listOf("Bash")), msg("2", tools = listOf("mcp__argus__push_notification")), msg("3", tools = listOf("Bash"))),
    )
    assertEquals(listOf("1", "2", "3"), segments.map { it.id })
  }

  @Test fun hoistsImageReadsOnlyWhenTheyShowOpen() {
    val image = message(
      "2",
      toolCalls = listOf(
        toolCall("2-0", "Read", resultBlocks = listOf(RemoteToolResultBlock.Image(RemoteToolResultBlockImage("image", "img", "image/png")))),
      ),
    )
    val run = listOf(msg("1", tools = listOf("Bash")), image, msg("3", tools = listOf("Bash")))
    assertEquals(listOf("group-1"), ToolGroups.group(run).map { it.id })
    assertEquals(listOf("1", "2", "3"), ToolGroups.group(run, hoistImageReads = true).map { it.id })
  }

  @Test fun emptyMessagesDoNotSplitAToolRun() {
    val segments = ToolGroups.group(
      listOf(msg("1", tools = listOf("Bash")), msg("e1"), msg("2", tools = listOf("Bash")), msg("e2"), msg("3", tools = listOf("Bash"))),
    )
    assertEquals(listOf("group-1"), segments.map { it.id })
  }

  @Test fun categorizesInFirstSeenOrder() {
    val messages = listOf(msg("1", tools = listOf("Bash", "Read")), msg("2", tools = listOf("Grep", "Bash")))
    assertEquals(
      listOf(ToolGroups.ToolCategory.BASH to 2, ToolGroups.ToolCategory.READ to 1, ToolGroups.ToolCategory.SEARCH to 1),
      ToolGroups.categorize(messages),
    )
    assertEquals(4, ToolGroups.countToolCalls(messages))
  }
}
