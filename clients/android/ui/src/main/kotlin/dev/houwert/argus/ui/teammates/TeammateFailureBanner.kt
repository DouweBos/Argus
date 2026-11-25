package dev.houwert.argus.ui.teammates

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.houwert.argus.kit.protocol.generated.TeammateThreadFailure
import dev.houwert.argus.kit.protocol.generated.TeammateThreadFailureKind
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.theme.Tone

/** Over a teammate conversation's composer when its last turn stopped short: why, and Resume. Null [onResume] hides it. */
@Composable
fun TeammateFailureBanner(failure: TeammateThreadFailure, onResume: (() -> Unit)?, modifier: Modifier = Modifier) {
  Banner(
    Labels.threadFailureDetail(failure),
    modifier,
    tone = if (failure.kind == TeammateThreadFailureKind.limit) Tone.Warning else Tone.Danger,
    title = Labels.threadFailureTitle(failure.kind),
    actionLabel = if (onResume == null) null else "Resume",
    actionTone = ButtonTone.Primary,
    onAction = onResume,
  )
}
