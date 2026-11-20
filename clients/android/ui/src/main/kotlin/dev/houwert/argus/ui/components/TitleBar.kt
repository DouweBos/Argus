package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A pushed screen's top bar: Back when there is somewhere to go back to, the title, and trailing actions. */
@Composable
fun TitleBar(title: String, modifier: Modifier = Modifier, onBack: (() -> Unit)? = null, actions: (@Composable RowScope.() -> Unit)? = null) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth().background(theme.bg)) {
    Row(
      Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp),
      horizontalArrangement = Arrangement.spacedBy(4.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (onBack != null) IconBtn(Icon.arrowBack, "Back", onClick = onBack) else Box(Modifier.width(12.dp))
      Text(
        title, Modifier.weight(1f).semantics { heading() }, color = theme.text, style = argusFont(18, FontWeight.SemiBold),
        maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
      actions?.invoke(this)
    }
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(theme.border))
  }
}
