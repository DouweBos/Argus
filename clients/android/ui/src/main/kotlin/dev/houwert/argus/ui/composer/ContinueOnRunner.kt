package dev.houwert.argus.ui.composer

import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.ContinueSource
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.canContinueElsewhere
import dev.houwert.argus.core.stores.continueOnRunner
import dev.houwert.argus.core.stores.continueRunners
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * "Continue on" for an agent's menu: an item per installed runner but the agent's own, to drop
 * into a `DropdownMenu`. Nothing when there's nowhere to go; disabled mid-turn.
 */
@Composable
fun ContinueOnMenuItems(
  host: HostStore,
  agentId: String,
  onContinued: (RemoteAgentStatus) -> Unit,
  onError: (String) -> Unit,
  onDismiss: () -> Unit,
) {
  host.runners.collectAsState().value
  host.statusByAgent.collectAsState().value
  host.capabilities.collectAsState().value
  val runners = host.continueRunners(agentId)
  if (!host.hasControl || runners.isEmpty()) return
  val enabled = host.canContinueElsewhere(agentId)
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  for (runner in runners) {
    DropdownMenuItem(
      text = { Text("Continue on ${runner.displayName}", color = theme.text, style = argusFont(15)) },
      leadingIcon = { Icon(Icon.continueOn, null, Modifier.size(18.dp), tint = theme.textSecondary) },
      enabled = enabled,
      onClick = {
        onDismiss()
        scope.launch {
          try {
            onContinued(host.continueOnRunner(agentId, runner.id, ContinueSource.Menu))
          } catch (error: Exception) {
            onError(HostStore.describe(error))
          }
        }
      },
    )
  }
}
