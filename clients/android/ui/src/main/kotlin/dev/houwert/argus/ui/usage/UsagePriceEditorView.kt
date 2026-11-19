package dev.houwert.argus.ui.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.usage.UsagePriceDraft
import dev.houwert.argus.core.usage.loadUsagePrices
import dev.houwert.argus.core.usage.saveUsagePrices
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** "Model prices": hand-set prices and mappings, edited in place and saved together. [onClose] leaves after Save or Cancel. */
@Composable
fun HostUsagePricesView(host: HostStore, canEdit: Boolean, modifier: Modifier = Modifier, onClose: () -> Unit) {
  val failure by host.usagePricesError.collectAsState()
  val connection by host.connection.collectAsState()
  val scope = rememberCoroutineScope()
  var draft by remember { mutableStateOf<UsagePriceDraft?>(null) }
  var saving by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  suspend fun load() {
    host.loadUsagePrices()
    val prices = host.usagePrices.value ?: return
    draft = UsagePriceDraft(prices, adding = if (canEdit) host.pendingPriceModel else null)
    host.pendingPriceModel = null
  }
  LaunchedEffect(connection == Transport.State.Ready) { if (connection == Transport.State.Ready && draft == null) load() }
  val current = draft
  when {
    current != null ->
      UsagePriceEditor(
        current, { draft = it }, canEdit, error, saving, modifier, onCancel = onClose,
        onSave = {
          current.overrides().fold(
            onSuccess = { overrides ->
              scope.launch {
                saving = true
                val refused = host.saveUsagePrices(overrides)
                saving = false
                error = refused
                if (refused == null) onClose()
              }
            },
            onFailure = { error = it.message },
          )
        },
      )
    failure != null ->
      EmptyState(Icon.warning, "Couldn't load model prices", modifier, body = failure, selectable = true) {
        Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.refresh) { scope.launch { load() } }
      }
    else -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading("Loading model prices") }
  }
}

/** The editor's rows (an add field, then a card per model) over a Cancel / Save footer. */
@Composable
fun UsagePriceEditor(
  draft: UsagePriceDraft,
  onDraft: (UsagePriceDraft) -> Unit,
  canEdit: Boolean,
  error: String?,
  saving: Boolean,
  modifier: Modifier = Modifier,
  onCancel: () -> Unit,
  onSave: () -> Unit,
) {
  val theme = ArgusTheme.colors
  var newModel by rememberSaveable { mutableStateOf("") }
  fun add() {
    draft.adding(newModel)?.let {
      onDraft(it)
      newModel = ""
    }
  }
  Column(modifier.fillMaxSize().imePadding()) {
    Screen(Modifier.weight(1f)) {
      Text(
        "US dollars per million tokens. A blank cache rate uses the input rate and 0 makes it free. Map a model to count it as another one.",
        color = theme.textMuted, style = argusFont(13),
      )
      if (error != null) Banner(error, tone = Tone.Danger)
      if (canEdit) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          ThemedTextField(newModel, { newModel = it }, "Add a model by id", Modifier.weight(1f), mono = true, input = TextInput.Code, onSubmit = ::add)
          Btn("Add model", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.plus, enabled = newModel.isNotBlank(), onClick = ::add)
        }
      }
      if (draft.rows.isEmpty()) {
        Box(Modifier.fillMaxWidth().heightIn(min = 320.dp)) {
          EmptyState(Icon.price, "No models yet", body = "Models used in the last 90 days show up here with their list price.")
        }
      } else {
        for (row in draft.rows) {
          Card {
            UsagePriceRowEditor(row, canEdit, onChange = { next -> onDraft(draft.updating(row.model) { next }) }) {
              onDraft(draft.togglingReset(row.model))
            }
          }
        }
      }
    }
    HorizontalDivider(color = theme.borderSubtle)
    Row(
      Modifier.fillMaxWidth().background(theme.bgSecondary).padding(ArgusMetrics.space),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (!canEdit) Text("Viewing only: this device can't change prices.", Modifier.weight(1f), color = theme.textMuted, style = argusFont(12))
      else Box(Modifier.weight(1f))
      Btn("Cancel", tone = ButtonTone.Secondary, small = true, hugs = true, onClick = onCancel)
      if (canEdit) Btn("Save changes", small = true, hugs = true, busy = saving, enabled = draft.isDirty && !saving, onClick = onSave)
    }
  }
}
