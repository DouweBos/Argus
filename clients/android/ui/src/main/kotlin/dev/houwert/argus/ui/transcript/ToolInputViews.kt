package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.util.Questions
import dev.houwert.argus.kit.util.ToolInputField
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Past this a value is cut off; the desktop is where you read a long one. */
private const val VALUE_LINE_LIMIT = 12

/**
 * A tool's input as labelled values. Braces and quotes carry nothing, so even a tool nobody wrote
 * a view for reads as a list.
 */
@Composable
fun ToolInputFieldsView(fields: List<ToolInputField>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    for (field in fields) {
      if (field.isLong) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          FieldLabel(field.label)
          MonoText(field.value, size = 11, maxLines = VALUE_LINE_LIMIT)
        }
      } else {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          FieldLabel(field.label)
          MonoText(field.value, size = 11, maxLines = 1)
        }
      }
    }
  }
}

@Composable
private fun FieldLabel(text: String) {
  Text(text, color = ArgusTheme.colors.textMuted, style = argusFont(10, FontWeight.Bold))
}

/** An answered AskUserQuestion: what was asked, and what was picked. [answer] is the only record of the picks. */
@Composable
fun AnsweredQuestionsView(questions: List<Questions.Question>, answer: String, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val parsed = remember(answer, questions) { Questions.parseAnswer(answer, questions) }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
    questions.forEachIndexed { index, question ->
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(question.header ?: question.question, color = theme.textMuted, style = argusFont(11, FontWeight.Bold))
        val answered = parsed[index]
        val picks = answered?.picks.orEmpty()
        val note = answered?.note
        if (picks.isEmpty() && note == null) {
          MutedText("No answer")
        } else {
          for (pick in picks) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              Icon(Icon.check, null, Modifier.padding(top = 3.dp).size(11.dp), tint = theme.success)
              Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(pick, color = theme.text, style = argusFont(13))
                question.options.firstOrNull { it.label == pick }?.description?.let { MutedText(it) }
              }
            }
          }
          if (note != null) MutedText(note)
        }
      }
    }
  }
}
