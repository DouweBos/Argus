package dev.houwert.argus.kit.push

import dev.houwert.argus.kit.crypto.ArgusBase64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Payloads produced by the desktop's own `seal.ts`; a mismatch shows a placeholder instead of the alert. */
class SealTest {
  private val pushKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
  private val nonce = "AwMDAwMDAwMDAwMD"
  private val sealed =
    "AwMDAwMDAwMDAwMDXtzXai5EO2BAYgIujCKMLsEegoDQ7LZKDZ/g1I2RYNbUwhlRu5rVMLznPWTh7Mtn" +
      "TE19oKu4HwdJWkPKTV/hB5nBF1rOwRF/Pa/Tpe61pVSYxL1YO1F9D8Bzp7IAc0htq4tUhZZBUy4PvgswSM8" +
      "/0PX6BToM8Y5ti6HF7BhhKdeZmc+nQmOISOtyMd04cbkHt0mt7bLjyHNjhxzX9Wax9hNd8y9gTsIAL7vLxg" +
      "m/hgYKnseuW+lVsti50Kb2JZQGQ3D4xmEeXXD+YCMqzJJxzbwq0tzl7EbiID7XDV6r"

  @Test fun opensDesktopPayload() {
    val opened = ArgusSeal.open(sealed, pushKey)
    assertNotNull(opened); opened!!
    assertEquals("Argus", opened.title)
    assertEquals("Agent needs approval", opened.body)
    assertEquals("permission", opened.kind)
    assertEquals("agent-123", opened.agentId)
    assertEquals("sess-9", opened.sessionId)
    assertEquals("tu-77", opened.toolUseId)
    assertEquals(listOf("approve", "deny"), opened.actions.map { it.id })
    assertEquals(listOf("Approve", "Deny"), opened.actions.map { it.title })
  }

  @Test fun sealRoundTrips() {
    val notification = SealedNotification(
      "Argus", "Agent needs approval", "permission", "agent-123", "sess-9", "tu-77",
      listOf(SealedNotificationAction("approve", "Approve"), SealedNotificationAction("deny", "Deny")),
    )
    val produced = ArgusSeal.seal(notification, pushKey, ArgusBase64.decode(nonce)!!)
    assertEquals(notification, ArgusSeal.open(produced, pushKey))
    assertArrayEquals(ArgusBase64.decode(nonce), ArgusBase64.decode(produced)!!.copyOfRange(0, 12))
  }

  @Test fun usageWarningCarriesTheAccountToSwitchTo() {
    val warning = SealedNotification(
      title = "Claude Code is at 91% of its limit", body = "Session limit.", kind = "usage",
      actions = listOf(SealedNotificationAction(NotificationAction.SWITCH_ACCOUNT, "Switch to Personal")),
      accountId = "personal",
    )
    val opened = ArgusSeal.open(ArgusSeal.seal(warning, pushKey, ArgusBase64.decode(nonce)!!), pushKey)
    assertEquals("personal", opened?.accountId)
    assertNull(ArgusSeal.collapseSubject("usage", null, null))
  }

  @Test fun collapseIdMatchesDesktop() {
    assertEquals("nwyawhtQoWIzki7AzDpCnA", ArgusSeal.collapseId(pushKey, "prompt-tu-77"))
  }

  @Test fun failsQuietly() {
    assertNull(ArgusSeal.open(sealed, ArgusBase64.encode(ByteArray(32) { 8 })))
    assertNull(ArgusSeal.open("AAAA", pushKey))
    assertNull(ArgusSeal.open(sealed, "not-a-key"))
  }

  @Test fun collapseSubjects() {
    assertEquals("agent-a1", ArgusSeal.collapseSubject("finished", "a1", null))
    assertEquals("prompt-t9", ArgusSeal.collapseSubject("permission", "a1", "t9"))
    assertNull(ArgusSeal.collapseSubject("push", "a1", null))
  }
}
