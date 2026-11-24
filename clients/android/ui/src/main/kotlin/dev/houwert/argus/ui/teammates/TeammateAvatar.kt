package dev.houwert.argus.ui.teammates

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.teammates.TeammateText
import dev.houwert.argus.core.teammates.symbol
import dev.houwert.argus.kit.protocol.generated.TeammateAvatar as AvatarSpec
import dev.houwert.argus.kit.protocol.generated.TeammateColor
import dev.houwert.argus.kit.protocol.generated.TeammateSymbol
import dev.houwert.argus.ui.theme.TeammatePalette
import dev.houwert.argus.ui.theme.argusFont

/** The Material glyph for each of a teammate's SF Symbols; the one mapping for teammates. */
object TeammateSymbols {
  fun icon(symbol: TeammateSymbol): ImageVector = when (symbol) {
    TeammateSymbol.wrench -> Icons.Outlined.Build
    TeammateSymbol.eye -> Icons.Outlined.Visibility
    TeammateSymbol.tray -> Icons.Outlined.Inbox
    TeammateSymbol.shippingbox -> Icons.Outlined.Inventory2
    TeammateSymbol.doc -> Icons.Outlined.Description
    TeammateSymbol.ant -> Icons.Outlined.BugReport
    TeammateSymbol.calendar -> Icons.Outlined.CalendarToday
    TeammateSymbol.leaf -> Icons.Outlined.Eco
    TeammateSymbol.sparkles -> Icons.Outlined.AutoAwesome
    TeammateSymbol.bolt -> Icons.Outlined.Bolt
    TeammateSymbol.magnifyingglass -> Icons.Outlined.Search
    else -> Icons.Outlined.Person
  }
}

/** A teammate's face: a circle tinted with its colour, holding its symbol or its initials. */
@Composable
fun TeammateAvatar(
  name: String,
  color: TeammateColor,
  avatar: AvatarSpec,
  modifier: Modifier = Modifier,
  size: Dp = 36.dp,
) {
  val tint = TeammatePalette.color(color)
  Box(
    modifier.size(size).background(tint.copy(alpha = 0.18f), CircleShape).semantics { contentDescription = name },
    contentAlignment = Alignment.Center,
  ) {
    val symbol = avatar.symbol
    if (symbol != null) {
      Icon(TeammateSymbols.icon(symbol), null, Modifier.size(size * 0.5f), tint = tint)
    } else {
      Text(TeammateText.initials(name), color = tint, style = argusFont((size.value * 0.38f).toInt(), FontWeight.SemiBold))
    }
  }
}
