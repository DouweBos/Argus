package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.CheckCodeCard
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.MenuAction
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.OverflowMenu
import dev.houwert.argus.ui.components.TextPromptDialog
import dev.houwert.argus.ui.icons.Icon

/** Dialogs, overflow menus and the check-code card. */
@Composable
internal fun DialogStories() {
  Story("Check code") { CheckCodeCard("482093") }
  Story("Overflow menu") {
    Row {
      MutedText("Mini")
      OverflowMenu("Manage Mini", listOf(MenuAction("Rename", Icon.pencil) {}, MenuAction("Remove", Icon.trash, destructive = true) {}))
    }
  }
  Story("Dialogs") {
    var confirm by remember { mutableStateOf(false) }
    var prompt by remember { mutableStateOf(false) }
    Row {
      Btn("Confirm", tone = ButtonTone.Secondary, small = true, hugs = true) { confirm = true }
      Btn("Rename", tone = ButtonTone.Secondary, small = true, hugs = true) { prompt = true }
    }
    if (confirm) {
      ConfirmDialog(
        "Remove “Mini” from your account?", "Remove", {}, { confirm = false },
        message = "Your devices stop connecting to it through the account.", destructive = true,
      )
    }
    if (prompt) TextPromptDialog("Rename “Mini”", "Mini", "Rename", {}, { prompt = false })
  }
}
