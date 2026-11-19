package dev.houwert.argus.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** One tile of [ActionTiles]. */
class ActionTile(val label: String, val icon: ImageVector, val disabled: Boolean = false, val run: () -> Unit)

/** A row of labelled option tiles, used instead of app-bar actions so titles keep their width. */
@Composable
fun ActionTiles(actions: List<ActionTile>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    for (action in actions) {
      val interaction = rememberInteraction()
      val tint = if (action.disabled) theme.textMuted else theme.textSecondary
      Column(
        Modifier.weight(1f)
          .alpha(if (action.disabled) 0.5f else 1f)
          .argusClickable(interaction, !action.disabled, shape, label = action.label, onClick = action.run)
          .background(theme.bgSecondary, shape)
          .border(1.dp, theme.border, shape)
          .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
      ) {
        Icon(action.icon, null, Modifier.size(20.dp), tint = tint)
        Text(action.label, color = tint, style = argusFont(10, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}

/** iOS's segmented control: a grey track with the picked segment raised on a sliding thumb. */
@Composable
fun <T> SegmentedControl(
  value: T,
  options: List<Pair<T, String>>,
  modifier: Modifier = Modifier,
  onChange: (T) -> Unit,
) {
  val theme = ArgusTheme.colors
  val index = options.indexOfFirst { it.first == value }.coerceAtLeast(0)
  BoxWithConstraints(
    modifier.fillMaxWidth().height(32.dp).background(theme.bgTertiary, RoundedCornerShape(9.dp)).padding(2.dp)
  ) {
    val segment = maxWidth / options.size.coerceAtLeast(1)
    val offset = animateDpAsState(segment * index, label = "thumb").value
    Box(
      Modifier.offset(x = offset)
        .width(segment)
        .fillMaxHeight()
        .dropShadow(RoundedCornerShape(7.dp), Shadow(4.dp, Color.Black.copy(alpha = 0.12f), offset = DpOffset(0.dp, 2.dp)))
        .background(theme.segmentSelected, RoundedCornerShape(7.dp))
    )
    Row(Modifier.fillMaxWidth()) {
      options.forEachIndexed { i, (option, label) ->
        val interaction = rememberInteraction()
        Box(
          Modifier.weight(1f)
            .fillMaxHeight()
            .argusClickable(interaction, shape = RoundedCornerShape(7.dp), role = Role.Tab, ripple = false) { onChange(option) }
            .semantics { selected = i == index },
          contentAlignment = Alignment.Center,
        ) {
          Text(
            label, color = theme.text, style = argusFont(13, if (i == index) FontWeight.SemiBold else FontWeight.Medium),
            maxLines = 1, overflow = TextOverflow.Ellipsis,
          )
        }
      }
    }
  }
}

/** What a text field holds: prose gets autocorrect, code (branches, globs, codes) is typed verbatim. */
enum class TextInput { Prose, Name, Code }

enum class TextKeyboard { Default, DecimalPad }

/** The app's text field: a filled, outlined box; `multiline` grows between `lines`. */
@Composable
fun ThemedTextField(
  value: String,
  onValueChange: (String) -> Unit,
  placeholder: String,
  modifier: Modifier = Modifier,
  multiline: Boolean = false,
  lines: IntRange = 2..6,
  keyboard: TextKeyboard = TextKeyboard.Default,
  mono: Boolean = false,
  input: TextInput = TextInput.Prose,
  secure: Boolean = false,
  enabled: Boolean = true,
  onSubmit: (() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val style = (if (mono) argusFont(14, mono = true) else argusFont(15)).copy(color = theme.text)
  val singleLine = !multiline || secure
  BasicTextField(
    value = value,
    onValueChange = onValueChange,
    modifier = modifier.fillMaxWidth(),
    enabled = enabled,
    textStyle = style,
    singleLine = singleLine,
    minLines = if (singleLine) 1 else lines.first,
    maxLines = if (singleLine) 1 else lines.last,
    cursorBrush = SolidColor(theme.accent),
    visualTransformation = if (secure) PasswordVisualTransformation() else VisualTransformation.None,
    keyboardOptions =
      KeyboardOptions(
        capitalization =
          when (input) {
            TextInput.Prose -> KeyboardCapitalization.Sentences
            TextInput.Name -> KeyboardCapitalization.Words
            TextInput.Code -> KeyboardCapitalization.None
          },
        autoCorrectEnabled = input != TextInput.Code && !secure,
        keyboardType =
          when {
            secure -> KeyboardType.Password
            keyboard == TextKeyboard.DecimalPad -> KeyboardType.Decimal
            input == TextInput.Code -> KeyboardType.Ascii
            else -> KeyboardType.Text
          },
        imeAction = if (onSubmit != null && singleLine) ImeAction.Done else ImeAction.Default,
      ),
    keyboardActions = KeyboardActions(onDone = { onSubmit?.invoke() }),
    decorationBox = { field ->
      Box(
        Modifier.background(theme.bgTertiary, shape).border(1.dp, theme.border, shape).padding(horizontal = 10.dp, vertical = 9.dp)
      ) {
        if (value.isEmpty()) Text(placeholder, color = theme.textMuted, style = style.copy(color = theme.textMuted))
        field()
      }
    },
  )
}
