package dev.houwert.argus.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.DesignViewerModel
import dev.houwert.argus.kit.protocol.generated.FigmaLayer
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.integrations.IntegrationIcon
import dev.houwert.argus.ui.integrations.linearColor
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.roundToInt

/** The selected layer: where it sits, its size, and what an implementer needs from it — text, font and fill. */
@Composable
fun DesignLayerInspector(model: DesignViewerModel, layer: FigmaLayer, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val tree = model.layerTree.value
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(IntegrationIcon.layer(layer.type), null, Modifier.size(14.dp), tint = theme.accent)
      SelectionContainer(Modifier.weight(1f)) {
        Text(layer.name, color = theme.text, style = argusFont(14, FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      IconBtn(Icon.close, "Clear selection", size = 16.dp) { model.select(null, DesignViewerModel.SelectionSource.Tree) }
    }
    tree.ancestors(layer.id).firstOrNull()?.let(tree::layer)?.let { parent ->
      val interaction = rememberInteraction()
      Row(
        Modifier.argusClickable(interaction, shape = RoundedCornerShape(6.dp), label = "Select the parent layer") {
          model.select(parent.id, DesignViewerModel.SelectionSource.Tree)
        }.padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(IntegrationIcon.parent, null, Modifier.size(12.dp), tint = theme.textSecondary)
        Text("In ${parent.name}", color = theme.textSecondary, style = argusFont(12), maxLines = 1)
      }
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Field("Type") { Value(DesignLayersText.typeName(layer.type)) }
      if (layer.x != null && layer.y != null) Field("Position") { Value("${layer.x!!.roundToInt()}, ${layer.y!!.roundToInt()}") }
      DesignLayersText.size(layer)?.let { Field("Size") { Value(it) } }
      layer.fill?.let { fill ->
        Field("Fill") {
          linearColor(fill)?.let { swatch ->
            Box(Modifier.size(10.dp).background(swatch, RoundedCornerShape(2.dp)).border(1.dp, theme.border, RoundedCornerShape(2.dp)))
          }
          Value(fill)
        }
      }
      layer.font?.let { Field("Font") { Value(it) } }
    }
    layer.text?.takeIf { it.isNotEmpty() }?.let { text ->
      SelectionContainer {
        Text(
          text, Modifier.fillMaxWidth().background(theme.bgSecondary, RoundedCornerShape(ArgusMetrics.radiusSmall)).padding(8.dp),
          color = theme.textSecondary, style = argusFont(12), maxLines = 6, overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

@Composable
private fun Field(name: String, value: @Composable () -> Unit) {
  Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(name, Modifier.width(64.dp), color = ArgusTheme.colors.textMuted, style = argusFont(12))
    value()
  }
}

@Composable
private fun Value(text: String) {
  SelectionContainer { Text(text, color = ArgusTheme.colors.text, style = argusFont(12, mono = true)) }
}
