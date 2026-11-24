package dev.houwert.argus.core.teammates

import dev.houwert.argus.kit.protocol.generated.TeammateAvatar
import dev.houwert.argus.kit.protocol.generated.TeammateAvatarInitials
import dev.houwert.argus.kit.protocol.generated.TeammateAvatarSymbol
import dev.houwert.argus.kit.protocol.generated.TeammateSummary
import dev.houwert.argus.kit.protocol.generated.TeammateSymbol
import dev.houwert.argus.kit.protocol.generated.TeammateThreadSurface

// The computed members the teammate screens read, on the generated types.

object TeammateText {
  /** Up to two letters: the first of the first two words, or the first two of a single word. */
  fun initials(name: String): String {
    val words = name.trim().split(Regex("[\\s_-]+")).filter { it.isNotEmpty() }
    val letters = when (words.size) {
      0 -> "?"
      1 -> words[0].take(2)
      else -> "${words[0].first()}${words[1].first()}"
    }
    return letters.uppercase()
  }

  /** "Fixes CI · 3 duties · paused", the row's second line. */
  fun subtitle(summary: TeammateSummary): String {
    val count = summary.dutyCount.toInt()
    val parts = listOfNotNull(
      summary.teammate.tagline.takeIf { it.isNotBlank() },
      if (count == 1) "1 duty" else "$count duties",
      "paused".takeIf { !summary.teammate.enabled },
    )
    return parts.joinToString(" · ")
  }

  fun handle(handle: String): String = "@$handle"

  /** Where a conversation came from; null for one started in Argus. */
  fun surfaceLabel(surface: TeammateThreadSurface): String? = when (surface) {
    TeammateThreadSurface.slack -> "Slack"
    TeammateThreadSurface.linear -> "Linear"
    TeammateThreadSurface.handoff -> "From a teammate"
    else -> null
  }
}

/** The symbol an avatar draws; null draws initials. */
val TeammateAvatar.symbol: TeammateSymbol? get() = (this as? TeammateAvatar.Symbol)?.value?.symbol

fun teammateAvatar(symbol: TeammateSymbol?): TeammateAvatar =
  if (symbol == null) TeammateAvatar.Initials(TeammateAvatarInitials("initials"))
  else TeammateAvatar.Symbol(TeammateAvatarSymbol("symbol", symbol))
