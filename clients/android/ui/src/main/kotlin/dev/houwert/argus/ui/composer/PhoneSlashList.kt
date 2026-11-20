package dev.houwert.argus.ui.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** The phone's slash-command menu: name, argument hint and description per row. */
@Composable
fun PhoneSlashList(
  commands: List<SlashCommandMenu.Command>,
  modifier: Modifier = Modifier,
  highlighted: Int = -1,
  pick: (SlashCommandMenu.Command) -> Unit,
) {
  val theme = ArgusTheme.colors
  val list = rememberLazyListState()
  // A hardware keyboard's arrows move the highlight; keep it in view.
  LaunchedEffect(highlighted) { if (highlighted >= 0) list.animateScrollToItem(highlighted) }
  LazyColumn(
    modifier.fillMaxWidth().heightIn(max = 190.dp).clip(RoundedCornerShape(ArgusMetrics.radiusSmall)).background(theme.bgTertiary),
    state = list,
  ) {
    itemsIndexed(commands, key = { _, command -> command.id }) { index, command ->
      val interaction = rememberInteraction()
      Column(
        Modifier.fillMaxWidth()
          .argusClickable(interaction, label = "/${command.name}") { pick(command) }
          .background(if (index == highlighted) theme.selection else Color.Transparent)
          .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(1.dp),
      ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
          Text("/${command.name}", color = theme.text, style = argusFont(14))
          if (command.argumentHint.isNotEmpty()) {
            Text(command.argumentHint, color = theme.textMuted, style = argusFont(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
        if (command.description.isNotEmpty()) {
          Text(command.description, color = theme.textMuted, style = argusFont(11), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }
}
