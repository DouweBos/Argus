package dev.houwert.argus.ui.composer

/** Told `(agentId, typing)` as the text changes and when it's sent or cleared, so a shared agent's huddle sees the phone composing. */
fun interface ComposerTyping {
  operator fun invoke(agentId: String, typing: Boolean)
}
