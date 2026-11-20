package dev.houwert.argus.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.DesignViewerModel
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetailsCommentsItem
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetailsPagesItem
import dev.houwert.argus.kit.protocol.generated.FigmaLayer
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.integrations.IntegrationIcon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.roundToInt

/** The layer list's strings, apart from Compose so they can be tested. */
object DesignLayersText {
  /** "200×24", or null without a size. */
  fun size(layer: FigmaLayer): String? {
    val width = layer.width ?: return null
    val height = layer.height ?: return null
    return "${width.roundToInt()}×${height.roundToInt()}"
  }

  /** `BOOLEAN_OPERATION` → `Boolean operation`. */
  fun typeName(type: String): String = type.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** The frame's layers as a tree, in drawing order: tap one to outline and inspect it; fold one to hide its children. */
@Composable
fun DesignLayersSection(model: DesignViewerModel, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val tree by model.layerTree.collectAsState()
  val collapsed by model.collapsed.collectAsState()
  val selectedId by model.selectedLayerId.collectAsState()
  Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    SectionHeader("Layers", count = tree.layers.size)
    if (tree.layers.isEmpty()) MutedText("Figma sent no layers for this frame.")
    for (layer in tree.visible(collapsed)) {
      key(layer.id) {
        val selected = selectedId == layer.id
        val parent = tree.hasChildren(layer.id)
        Row(
          Modifier.fillMaxWidth()
            .padding(start = (minOf(layer.depth.toInt(), 10) * 12).dp)
            .background(if (selected) theme.accentSoft else Color.Transparent, RoundedCornerShape(6.dp)),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          val fold = rememberInteraction()
          val folded = layer.id in collapsed
          Box(
            Modifier.size(32.dp).then(
              if (parent) Modifier.argusClickable(fold, shape = RoundedCornerShape(6.dp), label = if (folded) "Expand ${layer.name}" else "Collapse ${layer.name}") {
                model.toggleCollapsed(layer.id)
              } else Modifier
            ),
            contentAlignment = Alignment.Center,
          ) {
            if (parent) Icon(if (folded) Icon.chevronRight else Icon.chevronDown, null, Modifier.size(14.dp), tint = theme.textMuted)
          }
          val pick = rememberInteraction()
          Row(
            Modifier.weight(1f).heightIn(min = 36.dp)
              .argusClickable(pick, shape = RoundedCornerShape(6.dp), label = "Select ${layer.name}") {
                model.select(if (selected) null else layer.id, DesignViewerModel.SelectionSource.Tree)
              }
              .semantics { this.selected = selected }
              .padding(end = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Icon(IntegrationIcon.layer(layer.type), null, Modifier.size(14.dp), tint = if (selected) theme.accent else theme.textMuted)
            Text(
              layer.name, Modifier.weight(1f, fill = false), color = theme.text,
              style = argusFont(13, if (selected) FontWeight.SemiBold else FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            DesignLayersText.size(layer)?.let { Text(it, color = theme.textMuted, style = argusFont(11, mono = true), maxLines = 1) }
          }
        }
      }
    }
  }
}

/** What the designers said on the frame. */
@Composable
fun DesignCommentsSection(comments: List<FigmaFrameDetailsCommentsItem>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    SectionHeader("Comments", count = comments.size)
    for (comment in comments) {
      Column(
        Modifier.fillMaxWidth().background(theme.bgSecondary, RoundedCornerShape(ArgusMetrics.radiusSmall)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
      ) {
        Text(comment.author, color = theme.text, style = argusFont(12, FontWeight.SemiBold))
        SelectionContainer { Text(comment.body, color = theme.textSecondary, style = argusFont(14)) }
      }
    }
  }
}

/** The file's pages and their top-level frames, to move between them. */
@Composable
fun DesignPagesSection(
  pages: List<FigmaFrameDetailsPagesItem>,
  isCurrent: (String) -> Boolean,
  onOpen: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    SectionHeader("Pages", count = pages.size)
    for (page in pages) {
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(page.name, color = theme.textSecondary, style = argusFont(12, FontWeight.SemiBold))
        if (page.frames.isEmpty()) MutedText("No frames")
        for (frame in page.frames) {
          key(frame.url) {
            val current = isCurrent(frame.url)
            val interaction = rememberInteraction()
            Row(
              Modifier.fillMaxWidth().heightIn(min = 40.dp)
                .argusClickable(interaction, !current, RoundedCornerShape(6.dp), role = Role.Tab, label = "Open ${frame.name}") { onOpen(frame.url) }
                .background(if (current) theme.accentSoft else Color.Transparent, RoundedCornerShape(6.dp))
                .semantics { selected = current }
                .padding(horizontal = 6.dp),
              horizontalArrangement = Arrangement.spacedBy(6.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Icon(IntegrationIcon.number, null, Modifier.size(12.dp), tint = theme.textMuted)
              Text(frame.name, color = if (current) theme.accent else theme.text, style = argusFont(14), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
          }
        }
      }
    }
  }
}
