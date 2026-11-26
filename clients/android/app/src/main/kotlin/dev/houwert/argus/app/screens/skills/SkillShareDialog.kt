package dev.houwert.argus.app.screens.skills

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.skills.SkillShareModel
import dev.houwert.argus.kit.protocol.generated.SkillShareTarget
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** Share a skill as a gist or a GitHub repository, then hand its link to Android's share sheet. */
@Composable
internal fun SkillShareDialog(share: SkillShareModel, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val target by share.target.collectAsState()
  val isPublic by share.public.collectAsState()
  val repoName by share.repoName.collectAsState()
  val sharing by share.sharing.collectAsState()
  val error by share.error.collectAsState()
  val url by share.url.collectAsState()
  val (secret, open) = share.visibilityLabels(target)

  AlertDialog(
    onDismissRequest = onDismiss,
    containerColor = theme.surface,
    title = { Text("Share ${share.skill.name}", color = theme.text, style = argusFont(18, FontWeight.SemiBold)) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val published = url
        if (published != null) {
          Text(published, color = theme.text, style = argusFont(14, mono = true))
          Text("Anyone with access can install it by pasting this link into Install Skill.", color = theme.textSecondary, style = argusFont(13))
        } else {
          SegmentedControl(target, listOf(SkillShareTarget.gist to "Gist", SkillShareTarget.repo to "Repository")) { share.target.value = it }
          SegmentedControl(isPublic, listOf(false to secret, true to open)) { share.public.value = it }
          if (target == SkillShareTarget.repo) {
            ThemedTextField(repoName, { share.repoName.value = it }, share.folderName, mono = true, input = TextInput.Code, enabled = !sharing)
          }
          Text(share.hint(target), color = theme.textSecondary, style = argusFont(13))
          error?.let { Text(it, color = theme.error, style = argusFont(13)) }
        }
      }
    },
    confirmButton = {
      val published = url
      if (published != null) {
        Btn("Share link", small = true, hugs = true) {
          val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, published)
          context.startActivity(Intent.createChooser(send, null))
        }
      } else {
        Btn(if (sharing) "Publishing" else "Publish", small = true, hugs = true, enabled = !sharing) { scope.launch { share.share() } }
      }
    },
    dismissButton = { Btn(if (url == null) "Cancel" else "Done", Modifier, tone = ButtonTone.Ghost, small = true, hugs = true, onClick = onDismiss) },
  )
}
