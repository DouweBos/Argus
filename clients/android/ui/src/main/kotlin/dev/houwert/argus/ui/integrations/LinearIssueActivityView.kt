package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.LinearIssueActivity
import dev.houwert.argus.kit.protocol.generated.LinearComment
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEvent
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEventKind
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * Linear's Activity: history as one-liners, long runs folded away, comment threads as cards with
 * their replies and a reply box, a comment box last.
 */
@Composable
fun LinearIssueActivityView(
  issue: LinearIssueDetail,
  canComment: Boolean,
  posting: Boolean,
  /** The thread a reply is being posted in; null for a new comment. */
  postingIn: String?,
  /** True once posted. `parentId` replies in that thread. */
  onComment: suspend (body: String, parentId: String?) -> Boolean,
  onLink: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  var unfolded by remember(issue.id) { mutableStateOf(emptySet<String>()) }
  var draft by rememberSaveable(issue.id) { mutableStateOf("") }
  val scope = rememberCoroutineScope()
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(Modifier.padding(bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("Activity", Modifier.weight(1f), color = theme.text, style = argusFont(15, FontWeight.SemiBold))
      val subscribers = issue.subscribers.orEmpty()
      if (subscribers.isNotEmpty()) {
        Row(
          Modifier.clearAndSetSemantics { contentDescription = "Subscribers: " + subscribers.joinToString(", ") { it.name } },
          horizontalArrangement = Arrangement.spacedBy((-5).dp),
        ) {
          for (person in subscribers.take(5)) LinearAvatar(person.name, Modifier.border(1.5.dp, theme.bg, CircleShape), url = person.avatarUrl, size = 20.dp)
        }
      }
    }
    for (item in LinearIssueActivity.timeline(issue.history.orEmpty(), issue.comments)) {
      key(item.id) {
        when (item) {
          is LinearIssueActivity.Item.Event -> LinearHistoryLine(item.event)
          is LinearIssueActivity.Item.Folded ->
            if (item.id in unfolded) item.events.forEach { LinearHistoryLine(it) }
            else FoldedLine(item.events) { unfolded = unfolded + item.id }
          is LinearIssueActivity.Item.ThreadItem ->
            LinearThreadCard(item.thread, canComment, posting && postingIn == item.thread.replyTarget, onComment, onLink)
        }
      }
    }
    if (canComment) {
      LinearCommentComposer("Leave a comment", draft, { draft = it }, posting && postingIn == null, lines = 2..8, Modifier.padding(top = 6.dp)) {
        scope.launch { if (onComment(draft, null)) draft = "" }
      }
    }
  }
}

@Composable
private fun FoldedLine(events: List<LinearHistoryEvent>, onUnfold: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val summary = LinearIssueActivity.foldedSummary(events)
  Row(
    Modifier.fillMaxWidth().argusClickable(interaction, shape = RoundedCornerShape(6.dp), label = summary, onClick = onUnfold).padding(vertical = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(IntegrationIcon.unfold, null, Modifier.width(18.dp).size(14.dp), tint = theme.textMuted)
    Text(summary, color = theme.textMuted, style = argusFont(12), maxLines = 1)
  }
}

/** "ann set priority to High · 5w ago", with an icon for what changed. */
@Composable
fun LinearHistoryLine(event: LinearHistoryEvent, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val ago = Labels.timeAgo(event.createdAt)
  Row(
    modifier.clearAndSetSemantics { contentDescription = "${LinearIssueActivity.sentence(event)}, $ago" },
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Box(Modifier.width(18.dp).padding(top = 1.dp), contentAlignment = Alignment.Center) {
      val actor = event.actor
      if (actor != null && event.kind == LinearHistoryEventKind.created) LinearAvatar(actor, url = event.actorAvatarUrl, size = 16.dp)
      else Icon(IntegrationIcon.history(event.kind), null, Modifier.size(14.dp), tint = theme.textMuted)
    }
    Text(
      buildAnnotatedString {
        withStyle(SpanStyle(color = theme.textSecondary, fontWeight = FontWeight.Medium)) { append(event.actor ?: "Linear") }
        append(" ${event.text} · $ago")
      },
      color = theme.textMuted, style = argusFont(12), maxLines = 2,
    )
  }
}

/** A thread as a card: its first comment, the replies under it, and a reply box. */
@Composable
fun LinearThreadCard(
  thread: LinearIssueActivity.Thread,
  canReply: Boolean,
  posting: Boolean,
  onComment: suspend (String, String?) -> Boolean,
  onLink: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  var reply by rememberSaveable(thread.id) { mutableStateOf("") }
  val scope = rememberCoroutineScope()
  Column(modifier.fillMaxWidth().background(theme.bgSecondary, shape).border(1.dp, theme.borderSubtle, shape)) {
    LinearCommentBody(thread.root, onLink)
    for (comment in thread.replies) {
      Hairline()
      LinearCommentBody(comment, onLink)
    }
    val target = thread.replyTarget
    if (canReply && target != null) {
      Hairline()
      LinearCommentComposer("Leave a reply", reply, { reply = it }, posting, lines = 1..6, Modifier.padding(8.dp), inline = true) {
        scope.launch { if (onComment(reply, target)) reply = "" }
      }
    }
  }
}

@Composable
private fun Hairline() = Box(Modifier.fillMaxWidth().height(1.dp).background(ArgusTheme.colors.borderSubtle))

/** Avatar, name and time, the comment, and its reactions. */
@Composable
fun LinearCommentBody(comment: LinearComment, onLink: (String) -> Unit, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val author = comment.author ?: "Someone"
  Column(modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      LinearAvatar(author, url = comment.authorAvatarUrl, size = 18.dp)
      Text(author, color = theme.text, style = argusFont(12, FontWeight.SemiBold))
      Text(Labels.timeAgo(comment.createdAt), color = theme.textMuted, style = argusFont(12))
    }
    LinearMarkdown(comment.body, onLink, baseSize = 14)
    val reactions = comment.reactions.orEmpty()
    if (reactions.isNotEmpty()) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (reaction in reactions) {
          Text(
            "${reaction.emoji} ${reaction.count.toInt()}",
            Modifier.border(1.dp, theme.border, CircleShape).padding(horizontal = 7.dp, vertical = 2.dp)
              .semantics { contentDescription = "${reaction.emoji}, ${reaction.count.toInt()}" },
            color = theme.textSecondary, style = argusFont(12),
          )
        }
      }
    }
  }
}

/** A text box with a send button, posting as the computer's Linear user. */
@Composable
fun LinearCommentComposer(
  placeholder: String,
  text: String,
  onTextChange: (String) -> Unit,
  posting: Boolean,
  lines: IntRange,
  modifier: Modifier = Modifier,
  /** Inside a thread card. */
  inline: Boolean = false,
  onSend: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val empty = text.isBlank()
  val label = if (inline) "Reply" else "Comment"
  val interaction = rememberInteraction()
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
    ThemedTextField(text, onTextChange, placeholder, Modifier.weight(1f), multiline = true, lines = lines, input = TextInput.Prose)
    Box(
      Modifier.size(ArgusMetrics.minTouchTarget).argusClickable(interaction, !posting && !empty, CircleShape, label = label, onClick = onSend),
      contentAlignment = Alignment.Center,
    ) {
      if (posting) CircularProgressIndicator(Modifier.size(18.dp), color = theme.textMuted, strokeWidth = 2.dp)
      else Icon(Icon.send, label, Modifier.size(28.dp), tint = if (empty) theme.textMuted else theme.accent)
    }
  }
}
