package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessageCommand
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MessageCommandTest {
  @Test fun theBubbleShowsTheArgumentsUnderTheChipCopyKeepsWhatWasTyped() {
    var message = textMessage("m", RemoteMessageRole.user, listOf("/compact keep the plan"))
    assertEquals(listOf("/compact keep the plan"), message.bodyBlocks)
    message = message.copy(command = RemoteMessageCommand("compact", "keep the plan"))
    assertEquals("/compact", message.command?.label)
    assertEquals(listOf("keep the plan"), message.bodyBlocks)
    assertEquals("/compact keep the plan", message.copyText)
    message = message.copy(command = RemoteMessageCommand("review"))
    assertTrue(message.bodyBlocks.isEmpty())
  }
}
