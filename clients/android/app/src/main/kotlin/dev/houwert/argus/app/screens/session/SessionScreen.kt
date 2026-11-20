package dev.houwert.argus.app.screens.session

import dev.houwert.argus.app.telemetry.TelemetryEvent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.sessions.AgentOrder
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.stores.MovedChat
import dev.houwert.argus.core.stores.adoptSession
import dev.houwert.argus.core.stores.agents
import dev.houwert.argus.core.stores.loadAgents
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.stopAgent
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.isUnavailable
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.PillTab
import dev.houwert.argus.ui.components.PillTabBar
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/** The draft tab's id in the strip; never an agent's. */
private const val DRAFT_TAB = "new-agent"

/** What the chat keeps when the side panel is open beside it; wider windows split. */
private val MIN_CHAT_WIDTH = 380.dp
private val SPLIT_WIDTH = 840.dp

/**
 * One session, as the Mac shows it: its agents as tabs over the one in front, and
 * everything else about the session in a details sheet (a side panel on a tablet).
 * [route] is a [Route.Session], or a [Route.Agent] opened before its session is known.
 */
@Composable
fun SessionScreen(route: Route) {
  val app = LocalAppStore.current
  val host = app.host
  val router = LocalRouter.current
  val nav = router.sessionNav
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()

  val sessionId = (route as? Route.Session)?.id
  val agentId = (route as? Route.Agent)?.id
  val label = (route as? Route.Session)?.label ?: (route as? Route.Agent)?.label ?: "Session"
  val routeRepoRoot = (route as? Route.Session)?.repoRoot

  val statusByAgent by host.statusByAgent.collectAsState()
  val gone by host.goneAgents.collectAsState()
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  val adopted by host.adoptedSessions.collectAsState()
  val agentsByRepo by host.agentsByRepo.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val connection by host.connection.collectAsState()
  val focusState by nav.focused.collectAsState()
  val drafts by nav.newAgentDrafts.collectAsState()
  val panelOpen by nav.panelOpen.collectAsState()

  val resolvedSessionId = sessionId ?: agentId?.let { statusByAgent[it]?.sessionId }
  // Read so a list change recomposes; the lookups go through the store.
  @Suppress("UNUSED_EXPRESSION") sessionsByRepo; adopted; agentsByRepo; gone
  val session = resolvedSessionId?.let { host.session(it) }
  val repoRoot = session?.repoRoot ?: routeRepoRoot
  val hasControl = "control" in capabilities

  // Tabs this screen has shown; one that stops stays until closed or the screen is left, as on the Mac.
  val shown = remember { mutableStateListOf<String>() }
  val closed = remember { mutableStateListOf<String>() }
  var stopping by remember { mutableStateOf<String?>(null) }
  var menuFor by remember { mutableStateOf<String?>(null) }
  var showingDetails by rememberSaveable { mutableStateOf(false) }
  var error by remember { mutableStateOf<Pair<String, String>?>(null) }

  val focused = focusState.front(resolvedSessionId, agentId)
  val agents: List<RemoteAgentStatus> =
    if (resolvedSessionId == null || repoRoot == null) emptyList()
    else AgentOrder.sessionTabs(
      listed = host.agents(resolvedSessionId, repoRoot),
      // The tab picked too, live, so a fork or resume opened here shows before the list has it.
      kept = (listOfNotNull(agentId) + shown + listOfNotNull(focused?.takeIf { !host.isGone(it) })).filter { it !in closed },
      status = { statusByAgent[it] },
      isGone = { host.isGone(it) },
    )
  val ids = agents.map { it.agentId }
  val focusedAgentId = when {
    focused != null && focused in ids -> focused
    agentId != null && (ids.isEmpty() || agentId in ids) -> agentId
    else -> AgentOrder.byActivity(agents).firstOrNull()?.agentId
  }
  val focusedAgent = focusedAgentId?.let { id -> agents.firstOrNull { it.agentId == id } ?: statusByAgent[id] }
  val sessionTitle = session?.let(SessionActivity::title) ?: label
  val canStart = session != null && hasControl && session.status == RemoteSessionStatus.ready && !session.isUnavailable
  val drafting = canStart && resolvedSessionId != null && resolvedSessionId in drafts
  val showsStart = canStart && (drafting || focusedAgentId == null)
  val showsTabs = agents.size > 1 || (agents.isNotEmpty() && canStart)
  val title = when {
    drafting -> "New agent"
    focusedAgent != null -> Labels.agentName(focusedAgent, agents)
    focusedAgentId == null -> sessionTitle
    else -> label
  }
  val subtitle = (
    if (focusedAgentId == null || drafting) listOf(session?.let(SessionActivity::subtitle))
    else listOf(sessionTitle, session?.let(SessionActivity::subtitle))
    ).filterNotNull().filter { it.isNotEmpty() && it != title }.joinToString(" · ").ifEmpty { null }

  fun pick(id: String?) {
    val key = resolvedSessionId ?: agentId ?: return
    nav.focused.value = nav.focused.value.pick(id, resolvedSessionId, agentId)
    if (resolvedSessionId == null) nav.focused.value = nav.focused.value.withSession(key, id ?: return)
  }

  fun setDrafting(on: Boolean) {
    resolvedSessionId?.let { nav.setDrafting(it, on) }
  }

  fun focus(agent: RemoteAgentStatus) {
    showingDetails = false
    pick(agent.agentId)
    repoRoot?.let { scope.launch { host.loadAgents(it) } }
  }

  // A new agent in this session opens as its tab here, as on the Mac; one elsewhere is pushed.
  fun open(agent: RemoteAgentStatus, label: String) {
    if (resolvedSessionId != null && agent.sessionId == resolvedSessionId) focus(agent)
    else router.push(Route.Agent(agent.agentId, label))
  }

  fun moved(chat: MovedChat) {
    showingDetails = false
    val target = host.session(chat.sessionId)
    chat.agent?.let { nav.focusSession(chat.sessionId, it.agentId) }
    router.push(Route.Session(chat.sessionId, target?.let(SessionActivity::title) ?: "Session", target?.repoRoot ?: repoRoot ?: ""))
  }

  fun closeTab(id: String) {
    val next = AgentOrder.neighbour(id, ids)
    closed += id
    pick(next)
    captureSessionUsed(TelemetryEvent.SessionAction.CloseAgentTab)
  }

  // Pinned once shown, so a rebuilt screen agrees on the agent in front.
  LaunchedEffect(focusedAgentId, resolvedSessionId) {
    if (resolvedSessionId != null && nav.focused.value.session(resolvedSessionId) != focusedAgentId) pick(focusedAgentId)
  }
  LaunchedEffect(ids) {
    shown += ids.filter { it !in shown && it !in closed }
  }
  LaunchedEffect(resolvedSessionId) {
    val id = resolvedSessionId ?: return@LaunchedEffect
    // No project lists an automation run's session; opened straight from its agent, fetch it.
    if (host.session(id) == null) host.adoptSession(id)
    host.session(id)?.repoRoot?.let { host.loadAgents(it) }
  }
  LiveRefresh(enabled = connection == Transport.State.Ready && repoRoot != null) {
    val root = repoRoot ?: return@LiveRefresh
    host.loadAgents(root)
    host.loadSessions(root)
  }
  DisposableEffect(nav) {
    nav.chatsShown.value += 1
    onDispose { nav.chatsShown.value -= 1 }
  }
  // Back out of a "New agent" tab first, as closing it would.
  BackHandler(enabled = drafting && agents.isNotEmpty()) { setDrafting(false) }

  Column(Modifier.fillMaxSize().background(theme.bg)) {
    SessionTopBar(title, subtitle, onBack = router::pop) {
      if (session != null) {
        BoxWithConstraints {
          // Only a wide window shows the panel beside the chat; a phone keeps the details sheet.
          val split = maxWidth >= SPLIT_WIDTH
          IconBtn(if (split) Icon.sidePanel else Icon.details, if (split && panelOpen) "Hide side panel" else if (split) "Show side panel" else "Session details") {
            if (split) {
              nav.panelOpen.value = !panelOpen
            } else {
              showingDetails = true
              captureSessionUsed(TelemetryEvent.SessionAction.OpenDetails)
            }
          }
        }
      }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
      val width = maxWidth
      val split = width >= SPLIT_WIDTH
      Row(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).fillMaxHeight()) {
          if (showsTabs) {
            TabStrip(
              tabs = agents.map { agent ->
                PillTab(agent.agentId, Labels.agentName(agent, agents), if (agent.pinned == true) Icon.pin else Icon.agent, indicator = agent.awaiting != null)
              } + if (drafting) listOf(PillTab(DRAFT_TAB, "New agent", Icon.plus)) else emptyList(),
              selection = if (drafting) DRAFT_TAB else focusedAgentId,
              canAdd = canStart && !drafting,
              onSelect = { picked ->
                if (picked != DRAFT_TAB && picked != focusedAgentId) {
                  setDrafting(false)
                  pick(picked)
                  captureSessionUsed(TelemetryEvent.SessionAction.SwitchAgent)
                }
              },
              onAdd = {
                setDrafting(true)
                captureSessionUsed(TelemetryEvent.SessionAction.NewAgentTab)
              },
              onLongPress = { menuFor = it },
            )
          }
          if (session != null && !session.isUnavailable &&
            (if (session.status == RemoteSessionStatus.error) focusedAgentId != null else session.setupPending == true)
          ) {
            SetupBanner(session, Modifier.padding(12.dp))
          }
          Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
              drafting && session != null -> StartPane(session) { agent -> setDrafting(false); open(agent, Labels.agentName(agent)) }
              focusedAgentId != null -> androidx.compose.runtime.key(focusedAgentId) {
                AgentView(focusedAgentId, title) { agent, name -> open(agent, name) }
              }
              session?.status == RemoteSessionStatus.initializing -> Centered { SetupProgress(session) }
              session?.status == RemoteSessionStatus.deleting -> Centered { SessionDeleting(session) }
              session?.status == RemoteSessionStatus.error && !session.isUnavailable -> Centered { SetupFailed(session) }
              showsStart && session != null -> StartPane(session) { agent -> open(agent, Labels.agentName(agent)) }
              else -> EmptyState(Icon.agent, "No agents", body = "Agents started in this session from Argus on your computer appear here.")
            }
          }
        }
        if (session != null) {
          AnimatedVisibility(split && panelOpen, enter = slideInHorizontally { it }, exit = slideOutHorizontally { it }) {
            SidePanel(session, focusedAgentId, Modifier.widthIn(max = width - MIN_CHAT_WIDTH).fillMaxHeight()) { router.push(it) }
          }
        }
      }
    }
  }

  if (showingDetails && session != null) {
    DetailsSheet(
      session = session,
      agentId = focusedAgentId,
      open = { showingDetails = false; router.push(it) },
      newAgent = {
        showingDetails = false
        setDrafting(true)
        captureSessionUsed(TelemetryEvent.SessionAction.NewAgentTab)
      },
      deleted = { showingDetails = false; router.pop() },
      onDismiss = { showingDetails = false },
    )
  }

  menuFor?.let { id ->
    AgentTabMenu(
      agentId = id,
      isDraft = id == DRAFT_TAB,
      canClose = if (id == DRAFT_TAB) agents.isNotEmpty() else host.isGone(id) && (id != agentId || agents.size > 1),
      onDismiss = { menuFor = null },
      onCloseDraft = { setDrafting(false) },
      onCloseTab = { closeTab(id) },
      onStop = { stopping = id },
      onContinued = { focus(it) },
      onMoved = { moved(it) },
      onError = { title, message -> error = title to message },
    )
  }

  stopping?.let { id ->
    ConfirmDialog(
      title = "Shut down this agent?",
      confirmLabel = "Shut down",
      message = if (agents.firstOrNull { it.agentId == id }?.status == RemoteAgentStatusStatus.running)
        "It stops mid-turn and anything still queued for it is discarded."
      else "Its process ends and anything still queued for it is discarded.",
      destructive = true,
      onConfirm = {
        stopping = null
        // Stopped agents keep their tab, with Resume, until closed.
        pick(id)
        scope.launch { host.stopAgent(id) }
      },
      onDismiss = { stopping = null },
    )
  }

  error?.let { (title, message) ->
    NoticeDialog(title, message) { error = null }
  }
}

@Composable
private fun TabStrip(
  tabs: List<PillTab<String>>,
  selection: String?,
  canAdd: Boolean,
  onSelect: (String) -> Unit,
  onAdd: () -> Unit,
  onLongPress: (String) -> Unit,
) {
  val theme = ArgusTheme.colors
  val scroll = rememberScrollState()
  // A tab opened from elsewhere (a fork, a resume) can land off the edge; bring the pick into view.
  val index = tabs.indexOfFirst { it.id == selection }
  LaunchedEffect(index, tabs.size, scroll.maxValue) {
    if (index < 0 || tabs.size < 2) return@LaunchedEffect
    scroll.animateScrollTo(scroll.maxValue * index / (tabs.size - 1))
  }
  Column {
    Box(Modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 12.dp, vertical = 6.dp)) {
      PillTabBar(tabs, selection, onSelect, compact = true, onLongPress = onLongPress, trailing = {
        if (canAdd) IconBtn(Icon.plus, "New agent", onClick = onAdd)
      })
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
  }
}

/** The Mac's setup cards: a readable width, in the middle of the screen. */
@Composable
private fun Centered(content: @Composable () -> Unit) {
  Box(Modifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.Center) {
    Box(Modifier.widthIn(max = 520.dp)) { content() }
  }
}
