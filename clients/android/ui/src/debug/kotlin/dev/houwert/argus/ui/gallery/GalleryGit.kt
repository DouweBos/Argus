package dev.houwert.argus.ui.gallery

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.houwert.argus.core.git.DiffReviewComment
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideStop
import dev.houwert.argus.kit.protocol.generated.RemoteViewedFileState
import dev.houwert.argus.kit.util.DiffParser
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ChangedFileRow
import dev.houwert.argus.ui.components.CommitRow
import dev.houwert.argus.ui.components.DiffCommentBubble
import dev.houwert.argus.ui.components.FileDiffCard
import dev.houwert.argus.ui.components.ReviewDraftBar
import dev.houwert.argus.ui.components.ReviewGuideStopRow
import dev.houwert.argus.ui.components.ReviewableDiffHunksView
import dev.houwert.argus.ui.components.ViewedProgressBar
import dev.houwert.argus.ui.components.ViewedToggle

private val sampleDiff = listOf(
  "diff --git a/src/session/merge.ts b/src/session/merge.ts",
  "--- a/src/session/merge.ts",
  "+++ b/src/session/merge.ts",
  "@@ -8,6 +8,7 @@ export async function merge(session: Session) {",
  "   const repo = await openRepo(session.repoRoot)",
  "-  const base = await mergeBase(repo, session.branch)",
  "+  const how = projectSettings(repo).mergeStrategy ?? 'squash'",
  "+  await git.merge(repo, session.branch, { strategy: how })",
  "   return repo",
  "diff --git a/README.md b/README.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/README.md",
  "@@ -0,0 +1,2 @@",
  "+# Luma",
  "+Run `pnpm dev`.",
  "",
).joinToString("\n")

private val sampleStop = ProtocolJson.decode(
  RemoteReviewGuideStop.serializer(),
  ProtocolJson.json.parseToJsonElement(
    """{"id":"s1","title":"Merges follow the project's strategy","summary":"","mechanical":false,
    "look_closely":[{"note":"x"}],"paths":["src/session/merge.ts"],"ranges":[]}"""
  ),
)

@Composable
internal fun GitPage() {
  val files = remember { DiffParser.parse(sampleDiff) }
  val merge = files[0]
  val hunk = merge.hunks[0]
  val comment = remember {
    DiffReviewComment.draft(merge.displayPath, hunk, hunk.lines[2], "uncommitted changes")!!.copy(body = "Keep the merge base for repos without settings.")
  }
  Story("Changed files") {
    Card {
      ChangedFileRow(merge, viewedState = RemoteViewedFileState.viewed)
      ChangedFileRow(files[1], viewedState = RemoteViewedFileState.changed)
      ChangedFileRow(files[1])
    }
    ViewedProgressBar(1, 2)
  }
  Story("Viewed toggle") {
    var on by remember { mutableStateOf(false) }
    ViewedToggle(if (on) RemoteViewedFileState.viewed else null, { on = it })
    ViewedToggle(RemoteViewedFileState.changed, null)
  }
  Story("File diff card") {
    var viewed by remember { mutableStateOf<RemoteViewedFileState?>(null) }
    FileDiffCard(merge, viewedState = viewed, showsViewed = true, onViewedChange = { viewed = if (it) RemoteViewedFileState.viewed else null }, onViewFile = {})
    FileDiffCard(files[1])
  }
  Story("Reviewable hunks") {
    Card { ReviewableDiffHunksView(merge, listOf(comment), { _, _ -> }, {}, {}) }
    DiffCommentBubble(comment, {}, {})
  }
  Story("Review bar") {
    ReviewDraftBar(listOf(comment), "Send to agent", onDiscard = {}, onAction = {})
    ReviewDraftBar(emptyList(), "Finish Review", emptyTitle = "No comments yet", emptyHint = "Tap a line to comment", onDiscard = {}, onAction = {})
  }
  Story("Review guide stops") {
    Card {
      ReviewGuideStopRow(0, sampleStop, visited = true, comments = 2)
      ReviewGuideStopRow(1, sampleStop.copy(title = "README", mechanical = true, lookClosely = emptyList()), visited = false)
    }
  }
  Story("Commit row") {
    CommitRow("Merge with the project's strategy", "be0f64aa5da08bb0", "Ada Lovelace", "3h ago") {}
  }
}
