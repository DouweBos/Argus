package dev.houwert.argus.app.screens.devices

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.devices.next
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceOrientation
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceStateFold
import dev.houwert.argus.kit.protocol.generated.RemoteFoldPose
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme

private class DeviceButton(val id: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

/** The hardware buttons, the keyboard, and rotate, fold or end session where the device has them. */
@Composable
internal fun DeviceButtonBar(
  platform: RemotePlatform,
  isEas: Boolean,
  fold: RemoteDeviceStateFold?,
  orientation: RemoteDeviceOrientation?,
  busy: Boolean,
  onButton: (String) -> Unit,
  onKey: (String) -> Unit,
  onEndSession: () -> Unit,
  onRotate: (RemoteDeviceOrientation) -> Unit,
  onFold: (RemoteFoldPose) -> Unit,
) {
  val theme = ArgusTheme.colors
  val buttons = if (platform == RemotePlatform.ios) {
    listOf(DeviceButton("ios_home", "Home", Icon.home))
  } else {
    listOf(
      DeviceButton("back", "Back", Icon.androidBack),
      DeviceButton("home", "Home", Icon.home),
      DeviceButton("recents", "Recents", Icon.androidRecents),
    )
  }
  val keyboard = remember { FocusRequester() }
  val ime = LocalSoftwareKeyboardController.current
  Column(Modifier.fillMaxWidth().background(theme.bgSecondary).navigationBarsPadding()) {
    HorizontalDivider(color = theme.border)
    Row(
      Modifier.fillMaxWidth().padding(vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      buttons.forEach { button -> IconBtn(button.icon, button.label) { onButton(button.id) } }
      IconBtn(Icon.keyboard, "Keyboard") {
        keyboard.requestFocus()
        ime?.show()
      }
      if (isEas) {
        // Ending the session ends the device and its billing.
        IconBtn(Icon.stop, "End session", enabled = !busy, onClick = onEndSession)
      } else if (platform == RemotePlatform.ios) {
        IconBtn(Icon.rotate, "Rotate", enabled = !busy) { onRotate((orientation ?: RemoteDeviceOrientation.portrait).next) }
      }
      if (fold != null) {
        val open = fold.pose == RemoteFoldPose.open
        IconBtn(Icon.fold, if (open) "Fold device" else "Unfold device", enabled = !busy) {
          onFold(if (open) RemoteFoldPose.closed else RemoteFoldPose.open)
        }
      }
    }
    KeyboardCapture(keyboard, onKey)
  }
}

/** Holds one character so a backspace on an empty-looking field still reaches us. */
private const val SENTINEL = " "

/**
 * An off-screen field that forwards each typed character as a key event and keeps
 * nothing: the device holds the real text.
 */
@Composable
private fun KeyboardCapture(focus: FocusRequester, onKey: (String) -> Unit) {
  var value by remember { mutableStateOf(TextFieldValue(SENTINEL, TextRange(1))) }
  BasicTextField(
    value = value,
    onValueChange = { next ->
      val text = next.text
      when {
        text.isEmpty() -> onKey("Backspace")
        text.startsWith(SENTINEL) -> text.drop(1).forEach { onKey(if (it == '\n') "Enter" else it.toString()) }
        else -> text.forEach { onKey(it.toString()) }
      }
      value = TextFieldValue(SENTINEL, TextRange(1))
    },
    modifier = Modifier.size(1.dp).alpha(0f).focusRequester(focus),
    keyboardOptions = KeyboardOptions(
      capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Send,
    ),
    keyboardActions = KeyboardActions(onSend = { onKey("Enter") }),
    singleLine = true,
  )
}

/** Turns a hardware keyboard's or remote's arrows, Enter and Escape into d-pad presses. */
@Composable
internal fun HardwareKeyCatcher(press: (String) -> Unit, content: @Composable () -> Unit) {
  val theme = ArgusTheme.colors
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  Box(
    Modifier.fillMaxWidth()
      .background(theme.bgSecondary)
      .navigationBarsPadding()
      .focusRequester(focus)
      .onPreviewKeyEvent { event ->
        val button = dpadButton(event.key) ?: return@onPreviewKeyEvent false
        if (event.type == KeyEventType.KeyDown) press(button)
        true
      }
      .focusable(),
  ) {
    Column {
      HorizontalDivider(color = theme.border)
      content()
    }
  }
}

private fun dpadButton(key: Key): String? = when (key) {
  Key.DirectionUp -> "up"
  Key.DirectionDown -> "down"
  Key.DirectionLeft -> "left"
  Key.DirectionRight -> "right"
  Key.Enter, Key.NumPadEnter, Key.DirectionCenter -> "select"
  Key.Escape -> "menu"
  else -> null
}
