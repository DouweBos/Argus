package dev.houwert.argus.ui.blueprints

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.blueprints.scaffoldLabel
import dev.houwert.argus.kit.protocol.generated.Blueprint
import dev.houwert.argus.kit.protocol.generated.BlueprintRun
import dev.houwert.argus.kit.protocol.generated.BlueprintRunStatus
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.inbox.ProposalText
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone

/** The symbols the blueprint screens share. */
object BlueprintSymbol {
  val blueprint: ImageVector get() = Icon.blueprint
  val newProject: ImageVector get() = SfSymbol["folder.badge.plus"]
}

/**
 * One blueprint in a list: what it makes and how many projects it copies from. With
 * `onNewProject` it carries a trailing "new project from this" button.
 */
@Composable
fun BlueprintRow(
  blueprint: Blueprint,
  modifier: Modifier = Modifier,
  onClick: (() -> Unit)? = null,
  onNewProject: (() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .then(if (onClick != null) Modifier.argusClickable(interaction, label = "Open ${blueprint.name}", onClick = onClick) else Modifier)
      .padding(start = 16.dp, end = if (onNewProject != null) 4.dp else 16.dp, top = 10.dp, bottom = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
      Icon(BlueprintSymbol.blueprint, null, Modifier.size(20.dp), tint = theme.accent)
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(blueprint.name, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (blueprint.summary.isNotEmpty()) {
        Text(blueprint.summary, color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      Text(BlueprintRowText.meta(blueprint), color = theme.textMuted, style = ArgusTheme.typography.caption, maxLines = 1)
    }
    if (onNewProject != null) {
      IconBtn(BlueprintSymbol.newProject, "New project from ${blueprint.name}", tint = theme.accent, onClick = onNewProject)
    }
  }
}

object BlueprintRowText {
  fun meta(blueprint: Blueprint): String {
    val count = blueprint.references.size
    val references = if (count == 0) "No references" else ProposalText.plural(count, "reference")
    return "$references · ${blueprint.scaffoldLabel}"
  }

  fun label(status: BlueprintRunStatus): String = when (status) {
    BlueprintRunStatus.running -> "Running"
    BlueprintRunStatus.failed -> "Failed"
    BlueprintRunStatus.done -> "Done"
    else -> status.rawValue.replaceFirstChar { it.uppercase() }
  }

  fun tone(status: BlueprintRunStatus): Tone = when (status) {
    BlueprintRunStatus.running -> Tone.Accent
    BlueprintRunStatus.failed -> Tone.Danger
    BlueprintRunStatus.done -> Tone.Success
    else -> Tone.Muted
  }
}

/** A project made from a blueprint, for the run history; tappable once it has a session to open. */
@Composable
fun BlueprintRunRow(run: BlueprintRun, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .then(if (onClick != null) Modifier.argusClickable(interaction, label = "Open ${run.projectName}", onClick = onClick) else Modifier)
      .padding(horizontal = 16.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
      Text(run.projectName, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(Labels.timeAgo(run.startedAt), color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1)
    }
    Badge(BlueprintRowText.label(run.status), tone = BlueprintRowText.tone(run.status))
    if (onClick != null) Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}
