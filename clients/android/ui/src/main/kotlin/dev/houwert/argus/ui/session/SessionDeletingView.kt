package dev.houwert.argus.ui.session

import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.fraction
import dev.houwert.argus.kit.protocol.generated.RemoteSessionProgress
import dev.houwert.argus.kit.protocol.isTeardown

object SessionDeletingText {
  fun title(progress: RemoteSessionProgress?) =
    if (progress?.isTeardown == true) "Running teardown commands" else "Deleting the worktree"

  fun stepLine(progress: RemoteSessionProgress?): String {
    if (progress?.isTeardown != true || progress.total <= 0) return "Removing files"
    return "Command ${progress.current.toInt() + 1} of ${progress.total.toInt()}"
  }
}

/**
 * A session being deleted, laid out like [SetupProgressCard]: its teardown
 * commands' latest output while they run, then how much of the worktree is gone.
 */
@Composable
fun SessionDeletingView(progress: RemoteSessionProgress?, modifier: Modifier = Modifier) {
  val detail = progress?.detail?.takeIf { progress.isTeardown && it.isNotEmpty() }
  ProgressCard(
    title = SessionDeletingText.title(progress),
    stepLine = SessionDeletingText.stepLine(progress),
    fraction = progress?.fraction,
    lines = listOfNotNull(detail),
    modifier = modifier.widthIn(max = 520.dp),
  )
}
