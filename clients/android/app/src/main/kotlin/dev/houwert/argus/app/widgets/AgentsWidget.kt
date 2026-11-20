package dev.houwert.argus.app.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.compose.ui.unit.DpSize
import androidx.glance.LocalSize
import dev.houwert.argus.app.MainActivity
import dev.houwert.argus.kit.widgets.WidgetLink
import dev.houwert.argus.kit.widgets.WidgetSnapshot
import android.text.format.DateUtils

/** Agents that need you and the ones still running, across every paired computer. */
class AgentsWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(setOf(SMALL, WIDE))

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snapshots = WidgetStore.flow(context)
    provideContent {
      val snapshot by snapshots.collectAsState()
      GlanceTheme { AgentsContent(snapshot) }
    }
  }

  companion object {
    val SMALL = DpSize(110.dp, 110.dp)
    val WIDE = DpSize(250.dp, 110.dp)
  }
}

class AgentsWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = AgentsWidget()
}

private fun open(context: Context, url: String) =
  actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java))

@Composable
private fun AgentsContent(snapshot: WidgetSnapshot) {
  val context = LocalContext.current
  val needsYou = snapshot.needsYouCount
  val running = snapshot.runningCount
  val allAgents = WidgetLink.url("/agents")
  // A small widget is one tap target: the agent that most needs you, or the list.
  val first = snapshot.agents.firstOrNull { it.agent.needsYou }?.agent?.url ?: allAgents
  val small = LocalSize.current.width < AgentsWidget.WIDE.width
  Column(
    GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).cornerRadius(16.dp).padding(12.dp)
      .clickable(open(context, if (small) first else allAgents)),
  ) {
    if (small) {
      Text(needsYou.toString(), style = TextStyle(fontSize = 34.sp, fontWeight = FontWeight.Medium, color = GlanceTheme.colors.onSurface))
      Text(if (needsYou == 1) "agent needs you" else "agents need you", style = caption(), maxLines = 1)
      Spacer(GlanceModifier.defaultWeight())
      Row(verticalAlignment = Alignment.CenterVertically) {
        Dot(GlanceTheme.colors.primary)
        Spacer(GlanceModifier.width(6.dp))
        Text("$running running", style = caption())
      }
      Updated(snapshot)
    } else {
      Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Agents", style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold, color = GlanceTheme.colors.onSurface))
        Spacer(GlanceModifier.defaultWeight())
        Text("$needsYou waiting, $running running", style = caption())
      }
      Spacer(GlanceModifier.size(6.dp))
      val rows = snapshot.agents
      if (rows.isEmpty()) {
        Box(GlanceModifier.fillMaxWidth().defaultWeight(), contentAlignment = Alignment.Center) {
          Text(if (snapshot.isEmpty) "Open Argus to see your agents" else "No agents running", style = caption())
        }
      } else {
        val showHost = snapshot.hosts.size > 1
        LazyColumn(GlanceModifier.defaultWeight()) {
          items(rows, itemId = { it.agent.id.hashCode().toLong() }) { row -> AgentLine(row, showHost) }
        }
      }
      Updated(snapshot)
    }
  }
}

@Composable
private fun AgentLine(row: WidgetSnapshot.HostAgent, showHost: Boolean) {
  val agent = row.agent
  val place = listOfNotNull(agent.project, row.host.name.takeIf { showHost }).joinToString(", ")
  val state = agent.attention ?: "running"
  Row(
    GlanceModifier.fillMaxWidth().padding(vertical = 3.dp).clickable(open(LocalContext.current, agent.url)),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Dot(if (agent.needsYou) GlanceTheme.colors.tertiary else GlanceTheme.colors.primary)
    Spacer(GlanceModifier.width(8.dp))
    Column {
      Text(agent.title, style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium, color = GlanceTheme.colors.onSurface), maxLines = 1)
      Text(if (place.isEmpty()) state else "$state, $place", style = caption(), maxLines = 1)
    }
  }
}

@Composable
private fun Dot(color: ColorProvider) {
  Box(GlanceModifier.size(7.dp).cornerRadius(4.dp).background(color)) {}
}

/** Only one computer is connected at a time, so the others are as of the last visit. */
@Composable
private fun Updated(snapshot: WidgetSnapshot) {
  val at = snapshot.updatedAt
  val text = if (at == null) "Open Argus to sync" else "Updated " + DateUtils.getRelativeTimeSpanString(at, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)
  Text(text, style = TextStyle(fontSize = 11.sp, color = GlanceTheme.colors.onSurfaceVariant), maxLines = 1)
}

@Composable
private fun caption() = TextStyle(fontSize = 12.sp, color = GlanceTheme.colors.onSurfaceVariant)
