package dev.houwert.argus.app.screens.pair

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.BuildConfig
import dev.houwert.argus.app.DevPairing
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.core.remote.ClientPairingModel
import dev.houwert.argus.kit.net.PairingClientInfo

/** Pair with a computer: scan its QR or paste its code, then confirm the matching digits on the computer. */
@Composable
fun PairScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val model = remember {
    ClientPairingModel(
      scope = scope,
      client = PairingClientInfo(product = "Argus", kind = "mobile", device = app.deviceName, version = BuildConfig.VERSION_NAME),
      onPaired = { app.pairCompleted(it) },
    )
  }
  DisposableEffect(model) { onDispose { model.cancel() } }
  val state by model.state.collectAsState()
  // Debug builds on an emulator reach a host on this Mac through 10.0.2.2.
  val begin = { raw: String -> model.begin(DevPairing.rewrite(raw)) }

  LaunchedEffect(state.phase) { if (state.phase == ClientPairingModel.Phase.Paired) router.pop() }

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    when (val phase = state.phase) {
      is ClientPairingModel.Phase.AwaitingConfirmation -> Confirm(phase.sas) { model.cancel() }
      ClientPairingModel.Phase.Paired -> CircularProgressIndicator()
      ClientPairingModel.Phase.Scan -> Scan(state.error, begin)
    }
  }
}

@Composable
private fun Scan(error: String?, begin: (String) -> Unit) {
  var code by rememberSaveable { mutableStateOf("") }
  Text("Pair a computer", style = MaterialTheme.typography.headlineSmall)
  Text(
    "In Argus on your computer, open Settings, Remote, Start Pairing. A scanned pairing works on the same Wi-Fi, " +
      "or over Tailscale when both devices are on your tailnet.",
    style = MaterialTheme.typography.bodyMedium,
  )
  QrScanner(onCode = begin, modifier = Modifier.fillMaxWidth().aspectRatio(1f))
  Text("Or paste the pairing code", style = MaterialTheme.typography.labelLarge)
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    OutlinedTextField(
      value = code,
      onValueChange = { code = it },
      placeholder = { Text("Pairing code") },
      singleLine = true,
      modifier = Modifier.weight(1f).semantics { contentDescription = "Pairing code" },
    )
    Button(onClick = { begin(code) }, enabled = ClientPairingModel.canSubmit(code)) { Text("Pair") }
  }
  error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}

@Composable
private fun Confirm(sas: String, onCancel: () -> Unit) {
  Text("Confirm the code", style = MaterialTheme.typography.headlineSmall)
  Text(
    "Check this matches the code shown in Argus, then confirm on your computer.",
    style = MaterialTheme.typography.bodyMedium,
  )
  Text(
    sas.chunked(3).joinToString(" "),
    style = MaterialTheme.typography.displayMedium,
    modifier = Modifier.semantics { contentDescription = "Code ${sas.toList().joinToString(" ")}" },
  )
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    CircularProgressIndicator(Modifier.padding(4.dp))
    Text("Waiting for confirmation")
  }
  TextButton(onClick = onCancel) { Text("Cancel") }
}
