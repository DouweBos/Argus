package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.util.ToolCallSummary
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A collapsed subagent's latest tool calls, one line each, so a running subagent is never a closed box. */
@Composable
internal fun SubagentPreview(calls: List<RemoteToolCall>, earlier: Int, onExpand: () -> Unit) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.fillMaxWidth()
      .argusClickable(rememberInteraction(), label = "Subagent activity, ${calls.size + earlier} tool calls", onClick = onExpand)
      .padding(start = 16.dp)
      .height(IntrinsicSize.Min),
  ) {
    Box(Modifier.width(1.dp).fillMaxHeight().background(theme.borderSubtle))
    Column(Modifier.padding(start = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      for (call in calls) {
        Row(Modifier.alpha(0.85f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(
            ToolCallSummary.label(call.name, call.input), color = theme.accent.copy(alpha = theme.accent.alpha * 0.85f),
            style = argusFont(11, mono = true), maxLines = 1, softWrap = false,
          )
          MonoText(
            ToolCallSummary.summary(call.name, call.input), size = 11, color = theme.textMuted, maxLines = 1,
            truncateHead = ToolCallSummary.isPathTool(call.name),
          )
        }
      }
      if (earlier > 0) {
        Text(
          "+$earlier more".uppercase(), Modifier.padding(top = 2.dp), color = theme.textMuted,
          style = argusFont(9, FontWeight.SemiBold).copy(letterSpacing = 0.8.sp),
        )
      }
    }
  }
}
