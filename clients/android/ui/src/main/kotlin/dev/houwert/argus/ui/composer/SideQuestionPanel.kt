package dev.houwert.argus.ui.composer

import dev.houwert.argus.ui.transcript.MarkdownView
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.SideQuestion
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * Ask the agent something on the side: answered from a read-only copy of its context, kept out
 * of its chat unless sent there. The phone shows it in a bottom sheet.
 */
@Composable
fun SideQuestionPanel(host: ComposerHost, agentId: String, modifier: Modifier = Modifier, onSent: (() -> Unit)? = null) {
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val byAgent by host.sideQuestionsByAgent.collectAsState()
  val exchanges = byAgent[agentId].orEmpty()
  var draft by remember { mutableStateOf("") }
  fun ask() {
    val question = draft.trim()
    if (question.isEmpty()) return
    draft = ""
    scope.launch { host.askSide(agentId, question) }
  }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(ArgusMetrics.space)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("Side question", Modifier.weight(1f), color = theme.text, style = argusFont(15, FontWeight.SemiBold))
      if (exchanges.isNotEmpty()) {
        Btn("Clear", tone = ButtonTone.Ghost, small = true, hugs = true, enabled = exchanges.none { it.isPending }) {
          host.clearSideQuestions(agentId)
        }
      }
    }
    if (exchanges.isEmpty()) {
      MutedText("Answered from a read-only copy of the agent's context. Nothing is added to its chat.")
    } else {
      val list = rememberLazyListState()
      LaunchedEffect(exchanges.lastOrNull()?.id) { if (exchanges.isNotEmpty()) list.animateScrollToItem(exchanges.size - 1) }
      LazyColumn(Modifier.heightIn(max = 380.dp), state = list, verticalArrangement = Arrangement.spacedBy(ArgusMetrics.space)) {
        items(exchanges, key = { it.id }) { exchange ->
          SideQuestionRow(exchange) {
            onSent?.invoke()
            scope.launch { host.sendSideToAgent(agentId, exchange.id) }
          }
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
      ThemedTextField(draft, { draft = it }, "Ask without interrupting", Modifier.weight(1f), onSubmit = ::ask)
      Btn("Ask", small = true, hugs = true, enabled = draft.isNotBlank(), onClick = ::ask)
    }
  }
}

@Composable
private fun SideQuestionRow(exchange: SideQuestion, send: () -> Unit) {
  val theme = ArgusTheme.colors
  Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radiusSmall)).background(theme.bgTertiary).padding(10.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    SelectionContainer { Text(exchange.question, color = theme.text, style = argusFont(14, FontWeight.Medium)) }
    val answer = exchange.answer
    val error = exchange.error
    when {
      answer != null -> {
        SelectionContainer { MarkdownView(answer, baseSize = 14) }
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
          Btn(
            if (exchange.sent) "Sent" else "Send to agent", tone = ButtonTone.Secondary, small = true,
            icon = if (exchange.sent) Icon.check else Icon.reply, hugs = true, enabled = !exchange.sent, onClick = send,
          )
        }
      }
      error != null -> Text(error, color = theme.error, style = argusFont(13))
      else -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(14.dp), color = theme.textMuted, strokeWidth = 2.dp)
        MutedText("Thinking")
      }
    }
  }
}
