package dev.houwert.argus.ui.composer

import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.ReceiveContentListener
import androidx.compose.foundation.content.TransferableContent
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.drop

/**
 * The composer's text field: grows with its text up to [ComposerMetrics.maxFieldHeight], draws
 * its placeholder or a command's argument hint as ghost text, takes hardware keys through
 * [ComposerKeymap] and pasted images through `onPasteImages`.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ComposerField(
  composer: ComposerModel,
  placeholder: String?,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  focusRequester: FocusRequester = FocusRequester(),
  onKey: (ComposerKey) -> Boolean = { composer.handle(it) },
  onPasteImages: ((List<Uri>) -> Unit)? = null,
) {
  composer.observe()
  val theme = ArgusTheme.colors
  val style = argusFont(15).copy(color = theme.text)
  val state = rememberTextFieldState(composer.text.value)
  // The model edits too (a picked mention, a cleared send): mirror it in without fighting the user.
  LaunchedEffect(state, composer) {
    combine(composer.text, composer.caret) { _, _ -> }.collect {
      // The current value, not the emitted one: an emission can lag the user's typing and would undo it.
      val text = composer.text.value
      val caret = composer.caret.value
      if (state.text.toString() != text) {
        state.edit {
          replace(0, length, text)
          selection = TextRange(caret.coerceIn(0, text.length))
        }
      }
    }
  }
  LaunchedEffect(state, composer) {
    // The first value is the state's seed, not an edit; passing it on would wipe a draft loaded meanwhile.
    snapshotFlow { state.text.toString() to state.selection.start }.drop(1).collect { (text, caret) ->
      if (text != composer.text.value) composer.setText(text, caret) else composer.setCaret(caret)
    }
  }
  val receiver = onPasteImages?.let { paste ->
    ReceiveContentListener { content: TransferableContent ->
      if (!content.hasMediaType(MediaType.Image)) return@ReceiveContentListener content
      val uris = mutableListOf<Uri>()
      val texts = mutableListOf<String>()
      val rest = content.consume { item ->
        val uri = item.uri ?: return@consume false
        uris += uri
        // Consuming the item would otherwise drop the text it carries next to the image.
        PastedText.besideImages(item.text?.toString(), listOf(uri.toString()))?.let { texts += it }
        true
      }
      if (texts.isNotEmpty()) {
        val pasted = texts.joinToString("\n")
        state.edit {
          val start = selection.min
          replace(start, selection.max, pasted)
          selection = TextRange(start + pasted.length)
        }
      }
      if (uris.isNotEmpty()) paste(uris)
      rest
    }
  }
  Box(modifier.fillMaxWidth().heightIn(min = ComposerMetrics.collapsedFieldHeight, max = ComposerMetrics.maxFieldHeight)) {
    BasicTextField(
      state = state,
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 6.dp, vertical = 8.dp)
        .focusRequester(focusRequester)
        .onPreviewKeyEvent { event -> composerKey(event)?.let(onKey) ?: false }
        .then(if (receiver != null) Modifier.contentReceiver(receiver) else Modifier)
        .semantics { contentDescription = "Message" },
      enabled = enabled,
      textStyle = style,
      cursorBrush = SolidColor(theme.accent),
      lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 5),
      keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
    )
    val ghost = when {
      composer.text.value.isEmpty() -> placeholder?.let { buildAnnotatedString { withStyle(SpanStyle(color = theme.textMuted)) { append(it) } } }
      else -> composer.argumentHint?.let { hint ->
        buildAnnotatedString {
          withStyle(SpanStyle(color = Color.Transparent)) { append(composer.text.value) }
          withStyle(SpanStyle(color = theme.textMuted)) { append(hint) }
        }
      }
    }
    if (ghost != null) {
      Text(
        ghost, Modifier.padding(horizontal = 6.dp, vertical = 8.dp), style = style,
        maxLines = if (composer.text.value.isEmpty()) 1 else 5, overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

/** A hardware key the composer acts on; key-downs only, so a press is handled once. */
internal fun composerKey(event: KeyEvent): ComposerKey? {
  if (event.type != KeyEventType.KeyDown) return null
  val command = event.isCtrlPressed || event.isMetaPressed
  return when (event.key) {
    Key.Enter, Key.NumPadEnter -> ComposerKey.Return(event.isShiftPressed)
    Key.Tab -> ComposerKey.Tab(event.isShiftPressed)
    Key.DirectionUp -> if (command || event.isShiftPressed) null else ComposerKey.Up
    Key.DirectionDown -> if (command || event.isShiftPressed) null else ComposerKey.Down
    Key.Escape -> ComposerKey.Escape
    Key.Period -> if (command) ComposerKey.CommandPeriod else null
    else -> null
  }
}
