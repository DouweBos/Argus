package dev.houwert.argus.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.DesignCompareTarget
import dev.houwert.argus.core.stores.DesignViewerModel
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetails
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * A Figma frame as the agent sees it: the render to zoom into and tap layers on, the selected
 * layer, the designers' comments, the layers and the file's other frames, plus a compare against
 * a device. `compareTargets` null hides compare; empty shows it greyed out with `compareHint`.
 */
@Composable
fun DesignViewerView(
  model: DesignViewerModel,
  modifier: Modifier = Modifier,
  compareTargets: List<DesignCompareTarget>? = null,
  compareHint: String = "Boot a simulator or emulator on the computer to compare against it.",
) {
  val details by model.details.collectAsState()
  val loadError by model.loadError.collectAsState()
  LaunchedEffect(model) { if (model.details.value == null && model.loadError.value == null) model.load() }
  val shown = details
  Box(modifier.fillMaxSize().background(ArgusTheme.colors.bg), contentAlignment = Alignment.TopCenter) {
    when {
      shown != null -> Stacked(model, shown, compareTargets, compareHint)
      loadError != null -> EmptyState(Icon.warning, "Couldn't open the design", body = loadError, selectable = true)
      else -> Box(Modifier.padding(top = 48.dp)) { Loading("Asking Figma") }
    }
  }
}

@Composable
private fun Stacked(model: DesignViewerModel, details: FigmaFrameDetails, targets: List<DesignCompareTarget>?, hint: String) {
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val image by model.image.collectAsState()
  val comparison by model.comparison.collectAsState()
  val compareError by model.compareError.collectAsState()
  val selectedId by model.selectedLayerId.collectAsState()
  var comparedOn by remember { mutableStateOf<DesignCompareTarget?>(null) }
  val selected = model.layerTree.collectAsState().value.layer(selectedId)
  Column(
    Modifier.widthIn(max = ArgusMetrics.maxReadingWidth).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Header(model, details, targets, hint) { target ->
      comparedOn = target
      scope.launch { model.compare(target) }
    }
    if (model.designChanged) {
      Banner(
        "The designer has saved a newer version of this file. The agent was given the earlier one.",
        tone = Tone.Warning, title = "Design changed since this session started",
      )
    }
    compareError?.let { Banner(it, tone = Tone.Danger, title = "Couldn't compare") }
    val shownComparison = comparison
    if (shownComparison != null) {
      DesignComparisonView(shownComparison, model.differingPercent ?: 0, comparedOn?.name, onClose = model::clearComparison)
    } else {
      ZoomPanImage(
        image, details.frame.name,
        Modifier.fillMaxWidth()
          .aspectRatio((maxOf(details.frame.width, 1.0) / maxOf(details.frame.height, 1.0)).toFloat())
          .heightIn(max = 520.dp)
          .clip(RoundedCornerShape(ArgusMetrics.radiusSmall)),
      ) { fitted, zoom ->
        DesignLayerOverlay(model, details.frame.width, details.frame.height, fitted, zoom)
      }
    }
    selected?.let { DesignLayerInspector(model, it) }
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
      if (details.comments.isNotEmpty()) DesignCommentsSection(details.comments)
      DesignLayersSection(model)
      if (details.pages.isNotEmpty()) {
        DesignPagesSection(details.pages, model::isCurrent, onOpen = { url -> scope.launch { model.open(url) } })
      }
    }
  }
}

@Composable
private fun Header(
  model: DesignViewerModel,
  details: FigmaFrameDetails,
  targets: List<DesignCompareTarget>?,
  hint: String,
  onCompare: (DesignCompareTarget) -> Unit,
) {
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val uri = LocalUriHandler.current
  val history by model.history.collectAsState()
  val comparing by model.comparing.collectAsState()
  val url by model.url.collectAsState()
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
      if (history.isNotEmpty()) IconBtn(Icon.chevronLeft, "Previous frame", size = 20.dp) { scope.launch { model.back() } }
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        SelectionContainer { Text(details.frame.name, color = theme.text, style = argusFont(18, FontWeight.SemiBold)) }
        MutedText(DesignViewerText.subtitle(details), maxLines = 2)
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      if (targets != null) CompareControl(targets, comparing, hint, onCompare)
      Btn("Open in Figma", tone = ButtonTone.Ghost, small = true, icon = Icon.openExternal, hugs = true) {
        runCatching { uri.openUri(url) }
      }
    }
    if (targets?.isEmpty() == true) MutedText(hint, maxLines = 2)
  }
}

@Composable
private fun CompareControl(targets: List<DesignCompareTarget>, comparing: Boolean, hint: String, onCompare: (DesignCompareTarget) -> Unit) {
  val label = if (comparing) "Comparing" else "Compare with Simulator"
  var picking by remember { mutableStateOf(false) }
  Box {
    Btn(label, tone = ButtonTone.Secondary, small = true, icon = Icon.compare, hugs = true, busy = comparing, enabled = targets.isNotEmpty()) {
      if (targets.size > 1) picking = true else targets.firstOrNull()?.let(onCompare)
    }
    DropdownMenu(picking, { picking = false }) {
      for (target in targets) {
        DropdownMenuItem({ Text(target.name) }, onClick = {
          picking = false
          onCompare(target)
        })
      }
    }
  }
}

object DesignViewerText {
  /** "App · 390×844 pt · edited 2d ago". */
  fun subtitle(details: FigmaFrameDetails, nowMillis: Double = System.currentTimeMillis().toDouble()): String =
    listOf(
      details.file.name,
      "${details.frame.width.toInt()}×${details.frame.height.toInt()} pt",
      "edited ${Labels.timeAgo(details.file.lastModified, nowMillis)}",
    ).joinToString(" · ")
}
