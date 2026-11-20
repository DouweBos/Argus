package dev.houwert.argus.ui.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** The phone's `@` menu: matching directories then files, or one directory's entries led by "Link" for itself. */
@Composable
fun PhoneMentionList(
  header: String,
  items: List<MentionPicker.Item>,
  modifier: Modifier = Modifier,
  highlighted: Int = -1,
  pick: (MentionPicker.Item) -> Unit,
) {
  val theme = ArgusTheme.colors
  val list = rememberLazyListState()
  LaunchedEffect(highlighted) { if (highlighted >= 0) list.animateScrollToItem(highlighted) }
  Column(
    modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radiusSmall)).background(theme.bgTertiary).padding(bottom = 4.dp),
  ) {
    Text(
      header, Modifier.padding(start = 10.dp, end = 10.dp, top = 6.dp), color = theme.textMuted,
      style = argusFont(10, FontWeight.Bold), maxLines = 1, overflow = TextOverflow.StartEllipsis,
    )
    LazyColumn(Modifier.heightIn(max = 190.dp), state = list) {
      itemsIndexed(items, key = { _, item -> item.id }) { index, item -> MentionRow(item, index == highlighted) { pick(item) } }
    }
  }
}

@Composable
private fun MentionRow(item: MentionPicker.Item, highlighted: Boolean, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val title = if (item.isLinkAction) "Link ${item.display}" else item.display
  Row(
    Modifier.fillMaxWidth()
      .argusClickable(interaction, label = title, onClick = onClick)
      .background(if (highlighted) theme.selection else Color.Transparent)
      .padding(horizontal = 10.dp, vertical = 7.dp),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
      if (item.isLinkAction) Icon(Icon.link, null, Modifier.size(13.dp), tint = theme.textMuted)
      else FileTypeIcon(item.display, isDirectory = item.isDirectory, size = 15.dp)
    }
    Text(
      title, color = if (item.isLinkAction) theme.accent else theme.text, style = argusFont(14),
      maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
    val hint = item.hint
    if (!hint.isNullOrEmpty()) {
      Text(
        hint, Modifier.weight(1f, fill = false), color = theme.textMuted, style = argusFont(11),
        maxLines = 1, overflow = TextOverflow.StartEllipsis,
      )
    }
    Box(Modifier.weight(1f))
    if (item.isDirectory && !item.isLinkAction) Icon(Icon.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
  }
}
