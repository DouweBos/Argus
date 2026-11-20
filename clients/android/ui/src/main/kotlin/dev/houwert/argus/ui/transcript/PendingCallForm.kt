package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.handOffPlan
import dev.houwert.argus.core.stores.noteLeftPlanMode
import dev.houwert.argus.core.stores.respond
import dev.houwert.argus.core.stores.respondSecret
import dev.houwert.argus.core.transcript.PendingPrompts
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.util.AlwaysAllowRule
import dev.houwert.argus.kit.util.CannedReply
import dev.houwert.argus.kit.util.PendingForm
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** Every decision an agent is waiting on, each in a warning box: its title, the call itself, then the form that answers it. */
@Composable
fun TranscriptPrompts(pending: List<RemoteToolCall>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radius)
  Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
    for (call in pending) {
      Column(
        Modifier.fillMaxWidth().background(theme.warningSoft, shape).border(1.dp, theme.warning.copy(alpha = 0.5f), shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        PromptTitle(call)
        ToolCallCard(call)
        PendingCallForm(call, showsTitle = false)
      }
    }
  }
}

/** What a pending call is asking for, with a pulsing warning dot. */
@Composable
internal fun PromptTitle(call: RemoteToolCall) {
  Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
    StatusDot(Tone.Warning, pulse = true)
    Text(PendingPrompts.title(call), color = ArgusTheme.colors.text, style = argusFont(12, FontWeight.SemiBold))
  }
}

/**
 * The decision a pending call is waiting on: its question form, plan approval, secret field, or
 * Allow / Always Allow / Deny. Shared by top-level and sub-agent calls, which need an answer just the same.
 */
@Composable
fun PendingCallForm(call: RemoteToolCall, modifier: Modifier = Modifier, showsTitle: Boolean = true) {
  val env = transcriptEnvironment
  val host = env.host
  val agentKey = env.agentKey
  val capabilities by host.capabilities.collectAsState()
  val statuses by host.statusByAgent.collectAsState()
  fun respond(decision: String, message: String?) {
    env.scope.launch { host.respond(agentKey, call.id, decision, message) }
  }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (showsTitle) PromptTitle(call)
    when (val form = PendingForm.of(call.name, call.input)) {
      is PendingForm.Question ->
        QuestionFormView(form.questions, onSubmit = { respond("deny", it) }, onCancel = { respond("deny", CannedReply.CANCEL_QUESTION) })
      is PendingForm.Plan -> {
        // No repo, nowhere to put the session: same rule as the desktop.
        val repoRoot = statuses[agentKey]?.sessionId?.let(host::repoRoot)
        PlanApprovalView(
          form.plan,
          PlanAnswers(
            onApprove = {
              host.noteLeftPlanMode(agentKey)
              respond("allow", null)
            },
            onKeepPlanning = { respond("deny", CannedReply.KEEP_PLANNING) },
            onFeedback = { respond("deny", CannedReply.planFeedback(it)) },
            onApproveInNewSession = repoRoot?.let { root ->
              {
                env.scope.launch { host.handOffPlan(root, form.plan) }
                respond("deny", CannedReply.PLAN_HANDOFF)
              }
            },
          ),
        )
      }
      is PendingForm.Secret ->
        SecretRequestForm(
          form.request,
          onSubmit = { value -> env.scope.launch { host.respondSecret(agentKey, call.id, value) } },
          onDecline = { env.scope.launch { host.respondSecret(agentKey, call.id, null) } },
        )
      PendingForm.Buttons -> {
        // A session rule outlives this one call, so it needs the control grant.
        val alwaysAllow =
          if ("control" in capabilities) {
            val rule = AlwaysAllowRule.rule(call.name, call.input)
            rule to { env.scope.launch { host.respond(agentKey, call.id, "allow", alwaysAllow = rule) }; Unit }
          } else {
            null
          }
        PermissionButtons(onAllow = { respond("allow", null) }, onDeny = { respond("deny", null) }, alwaysAllow = alwaysAllow)
      }
    }
  }
}
