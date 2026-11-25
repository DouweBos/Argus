package dev.houwert.argus.ui.mermaid

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.design.ZoomPanImage
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import dev.houwert.argus.ui.transcript.CodeBlockView
import kotlinx.coroutines.delay

/**
 * A ```mermaid fence, drawn. Pinch or the buttons zoom it, Expand opens it full screen, and Copy
 * Source copies what the agent wrote. Source Mermaid can't draw shows as a code block with
 * Mermaid's error, never an empty box.
 */
@Composable
fun MermaidDiagramView(source: String, modifier: Modifier = Modifier, maxHeightDp: Float = 420f) {
  val theme = ArgusTheme.colors
  val palette = remember(theme) { MermaidPalette.of(theme) }
  val context = LocalContext.current
  val preview = LocalInspectionMode.current
  var outcome by remember(source) { mutableStateOf(MermaidRenderer.cached(source, palette)) }
  LaunchedEffect(source, palette) {
    if (preview) return@LaunchedEffect
    MermaidRenderer.attach(context)
    // Keeps the old picture while the other scheme's renders, rather than flashing a spinner.
    outcome = MermaidRenderer.cached(source, palette) ?: MermaidRenderer.render(source, palette)
  }
  when (val shown = outcome) {
    is MermaidRenderer.Outcome.Rendered -> Rendered(source, shown.diagram, maxHeightDp, modifier)
    is MermaidRenderer.Outcome.Invalid -> Failed(source, shown.message, modifier)
    null -> Frame(source, expand = null, modifier) {
      Box(Modifier.fillMaxWidth().height(96.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.size(18.dp), color = theme.textMuted, strokeWidth = 2.dp)
      }
    }
  }
}

@Composable
private fun Rendered(source: String, diagram: MermaidRenderer.Diagram, maxHeightDp: Float, modifier: Modifier) {
  var expanded by remember { mutableStateOf(false) }
  val image = dev.houwert.argus.ui.design.rememberPngBitmap(diagram.png)
  Frame(source, expand = { expanded = true }, modifier) {
    // Never past its own size: a small diagram isn't blown up to the column's width.
    ZoomPanImage(image, "Diagram", Modifier.fillMaxWidth().height(minOf(maxHeightDp, diagram.heightDp).dp + 24.dp).padding(vertical = 12.dp))
  }
  if (expanded) MermaidExpanded(diagram, source) { expanded = false }
}

@Composable
private fun Failed(source: String, message: String, modifier: Modifier) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Icon(Icons.warning, null, Modifier.size(14.dp).padding(top = 1.dp), tint = theme.error)
      SelectionContainer {
        Text("Mermaid couldn't draw this diagram: $message", color = theme.error, style = argusFont(12))
      }
    }
    CodeBlockView(source, language = "mermaid")
  }
}

@Composable
private fun Frame(source: String, expand: (() -> Unit)?, modifier: Modifier, content: @Composable () -> Unit) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  Column(modifier.fillMaxWidth().clip(shape).background(theme.bgSecondary).border(1.dp, theme.border, shape)) {
    Row(Modifier.fillMaxWidth().height(28.dp).padding(start = 8.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("mermaid", color = theme.textMuted, style = argusFont(10, FontWeight.SemiBold))
      Spacer(Modifier.weight(1f))
      if (expand != null) IconBtn(Icons.expand, "Expand", size = 14.dp, onClick = expand)
      CopySourceButton(source, 14)
    }
    content()
  }
}

/** Copy Source, flipping to a check for a moment once copied. */
@Composable
private fun CopySourceButton(source: String, size: Int) {
  val clipboard = LocalClipboardManager.current
  var copied by remember { mutableStateOf(false) }
  LaunchedEffect(copied) {
    if (!copied) return@LaunchedEffect
    delay(1500)
    copied = false
  }
  IconBtn(if (copied) Icons.check else Icons.copy, "Copy Source", size = size.dp) {
    clipboard.setText(AnnotatedString(source))
    copied = true
  }
}

/** The diagram full screen, for detail too small inline. */
@Composable
private fun MermaidExpanded(diagram: MermaidRenderer.Diagram, source: String, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Column(Modifier.fillMaxSize().background(theme.bg).statusBarsPadding().navigationBarsPadding()) {
      Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Diagram", color = theme.text, style = argusFont(13, FontWeight.SemiBold))
        Spacer(Modifier.weight(1f))
        CopySourceButton(source, 18)
        IconBtn(Icons.close, "Close", size = 18.dp, onClick = onDismiss)
      }
      Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
      ZoomPanImage(diagram.png, "Diagram", Modifier.fillMaxSize())
    }
  }
}

@Preview(name = "Mermaid: flowchart, sequence, broken", heightDp = 700)
@Composable
private fun MermaidDiagramPreview() {
  ArgusTheme(dark = true) {
    Column(
      Modifier.background(ArgusTheme.colors.bg).verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      MermaidDiagramView("flowchart LR\n  A[Agent] --> B{Tests pass?}\n  B -- yes --> C[Merge]\n  B -- no --> A")
      MermaidDiagramView("sequenceDiagram\n  Phone->>Host: files.read_bytes\n  Host-->>Phone: base64")
      Failed("flowchart LR\n  A -->", "Parse error on line 2", Modifier)
    }
  }
}
