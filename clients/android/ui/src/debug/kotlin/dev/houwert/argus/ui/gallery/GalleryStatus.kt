package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ConnectionBadge
import dev.houwert.argus.ui.components.ContextMeter
import dev.houwert.argus.ui.components.ControlRequiredBanner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.HatchedFill
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PullRequestStateIcon
import dev.houwert.argus.ui.components.QuietEmptyState
import dev.houwert.argus.ui.components.RunStatusBadge
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.ThinkingDots
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.components.WorkingIndicator
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone

@Composable
internal fun StatusPage() {
  Story("Text") {
    TitleText("Unify the start composer")
    BodyText("The agent rebased onto main and resolved two conflicts in the session store.")
    MutedText("Updated 4m ago on this Mac")
    MonoText("packages/host/src/services/session/merge.ts", maxLines = 1, truncateHead = true)
  }
  Story("Badges") {
    FlowRow(spacing = 6.dp, packed = true) {
      for (tone in Tone.entries) Badge(tone.name, tone = tone)
      Badge("Needs approval", tone = Tone.Warning)
    }
    FlowRow(spacing = 6.dp, packed = true) {
      for (status in RemoteAutomationRunStatus.entries) RunStatusBadge(status)
    }
  }
  Story("Status dots") {
    HRow {
      for (tone in Tone.entries) StatusDot(tone)
      StatusDot(Tone.Accent, pulse = true, contentDescription = "Working")
      for (state in Transport.State.entries) ConnectionBadge(state)
    }
  }
  Story("Banners") {
    Banner("Two agents are waiting on you.", tone = Tone.Warning, title = "Needs attention", actionLabel = "Review", onAction = {})
    Banner("Merged into main. The worktree was removed.", tone = Tone.Success, onDismiss = {})
    Banner("Couldn't reach the computer. Retrying in 8s.", tone = Tone.Danger, actionLabel = "Retry", actionTone = ButtonTone.Primary, onAction = {})
    Banner("Claude Code 2.1 is available on this computer.", tone = Tone.Accent)
    ControlRequiredBanner("start sessions")
  }
  Story("Cards") {
    Card {
      TitleText("Argus")
      MutedText("12 sessions · 3 running")
    }
    Card(tone = Tone.Danger, onClick = {}) {
      BodyText("Nightly dependency audit failed")
      MutedText("Exited with code 1 after 2m 14s")
    }
    Field("Prompt", caption = "Sent as the agent's first message.") { BodyText("Audit the lockfile and open a PR.") }
  }
  Story("Indicators") {
    WorkingIndicator("Reading 4 files")
    WorkingIndicator("Waiting for permission", blocked = true)
    HRow {
      ThinkingDots()
      ContextMeter(42_000, 200_000)
      ContextMeter(152_000, 200_000)
      ContextMeter(191_000, 200_000)
    }
    HRow {
      for (state in SessionPullRequestState.entries) PullRequestStateIcon(state, "Pull request #42 · ${state.rawValue}")
      PullRequestStateIcon(SessionPullRequestState.open, "Watched", watching = true)
    }
    Row(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp))) {
      Box(Modifier.weight(0.6f).height(10.dp).clip(RoundedCornerShape(0.dp))) { HatchedFill(ArgusTheme.colors.accent, Modifier.fillMaxWidth().height(10.dp)) }
      Box(Modifier.weight(0.4f))
    }
  }
  Story("Empty, loading and failed") {
    Box(Modifier.fillMaxWidth().height(240.dp)) {
      EmptyState(Icon.inbox, "Inbox zero", body = "Nothing needs you right now.") {
        Btn("Refresh", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.refresh) {}
      }
    }
    Box(Modifier.fillMaxWidth().height(140.dp)) {
      QuietEmptyState(Icon.done, "Nothing to commit", message = "Your working tree is clean.")
    }
    Loading("Loading sessions")
    Box(Modifier.fillMaxWidth().height(260.dp)) {
      LoadPhaseBox(loaded = true, error = "The computer didn't answer in time.", isEmpty = true, onRetry = {}, empty = {}) {}
    }
  }
  Box(Modifier.height(24.dp))
}
