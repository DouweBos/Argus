package dev.houwert.argus.core.routing

import dev.houwert.argus.core.usage.UsageTab
import dev.houwert.argus.core.usage.default
import dev.houwert.argus.core.routing.ArgusRoute.Companion.ISSUE_SEARCH_SEGMENT
import dev.houwert.argus.core.routing.ArgusRoute.Companion.issuesBase
import dev.houwert.argus.core.routing.ArgusRoute.Companion.usageRange
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// Paths as `docs/routing.md` spells them, for deep links and the NavHost, read the way the
// Swift and TypeScript codecs read them.

internal fun parseRoute(raw: String): ArgusRoute? {
  val (path, query) = splitPath(raw)
  val parts = path.split('/').filter { it.isNotEmpty() }.map { percentDecode(it) ?: it }
  val first = parts.firstOrNull() ?: return ArgusRoute.Home
  val count = parts.size
  return when (first) {
    "agents" -> if (count == 1) ArgusRoute.Agents else null
    "runtimes" -> if (count == 1) ArgusRoute.Runtimes else null
    "devices" -> when (count) {
      1 -> ArgusRoute.Devices
      3 -> ArgusRoute.Device(parts[1], parts[2])
      else -> null
    }
    "inbox" -> when {
      count == 1 -> ArgusRoute.Inbox(InboxFilter(query["automation"].nonEmpty(), query["project"].nonEmpty()))
      count == 3 && parts[1] == "proposals" -> ArgusRoute.Proposal(parts[2])
      else -> null
    }
    "notifications" -> if (count == 1) ArgusRoute.Notifications else null
    "usage" -> parseUsage(parts, query)
    "compare" -> if (count == 2) ArgusRoute.CompareRun(parts[1]) else null
    "pull-requests" -> parsePullRequest(parts)
    "issues" -> if (count in 1..3) parseIssues(parts, query) else null
    "design" -> {
      val url = query["url"].nonEmpty()
      if (count == 1 && url != null) ArgusRoute.Design(url, query["session"].nonEmpty()) else null
    }
    "blueprints" -> when {
      count == 1 -> ArgusRoute.Blueprints
      count != 2 -> null
      parts[1] == "new" -> ArgusRoute.Blueprint(null)
      parts[1] == "generate" -> ArgusRoute.GenerateBlueprint
      parts[1] == "new-project" -> ArgusRoute.NewProject(query["blueprint"].nonEmpty())
      else -> ArgusRoute.Blueprint(parts[1])
    }
    "automations" -> when {
      count == 1 -> ArgusRoute.Automations
      count == 2 && parts[1] == "quick" -> ArgusRoute.QuickRun(null)
      count == 2 && parts[1] == "describe" -> ArgusRoute.DescribeAutomation
      count == 4 && parts[1] == "quick" && parts[2] == "runs" -> ArgusRoute.QuickRun(parts[3])
      count == 2 -> ArgusRoute.Automation(parts[1], null)
      count == 4 && parts[2] == "runs" -> ArgusRoute.Automation(parts[1], parts[3])
      else -> null
    }
    "sessions" -> parseSession(parts, query)
    else -> null
  }
}

private fun parseUsage(parts: List<String>, query: Map<String, String>): ArgusRoute? = when (parts.size) {
  1 -> ArgusRoute.Usage(UsageTab.Limits)
  2 -> when (parts[1]) {
    "prices" -> ArgusRoute.UsagePrices
    "models" -> ArgusRoute.UsageModels
    else -> {
      // An unknown tab falls back to limits, as the other clients do.
      val tab = UsageTab.fromRaw(parts[1]) ?: UsageTab.Limits
      ArgusRoute.Usage(tab, if (tab == UsageTab.Limits) null else usageRange(query["range"]))
    }
  }
  5 -> {
    val tab = UsageTab.fromRaw(parts[1])
    if (parts[2] == "models" && tab != null && tab != UsageTab.Limits) {
      ArgusRoute.UsageModel(tab, parts[3], parts[4], usageRange(query["range"]))
    } else {
      null
    }
  }
  else -> null
}

private fun parsePullRequest(parts: List<String>): ArgusRoute? {
  val count = parts.size
  if (count == 1) return ArgusRoute.PullRequests
  // A GitLab project can sit in nested groups: `/pull-requests/group/sub/project/12[/guide]`.
  if (count >= 5 && parts.last() == "guide") {
    val number = parts[count - 2].toIntOrNull() ?: return null
    return ArgusRoute.PullRequestGuide(parts.subList(1, count - 2).joinToString("/"), number)
  }
  if (count >= 4) {
    val number = parts.last().toIntOrNull() ?: return null
    return ArgusRoute.PullRequest(parts.subList(1, count - 1).joinToString("/"), number)
  }
  return null
}

/** `/issues[/<scope>][/<IDENTIFIER>]` and `/issues/search[/<IDENTIFIER>]?q=`; a search without a term is the bare list. */
private fun parseIssues(parts: List<String>, query: Map<String, String>): ArgusRoute? {
  val second = parts.getOrNull(1)
  val searching = second == ISSUE_SEARCH_SEGMENT
  val scope = LinearIssueScope.entries.firstOrNull { it.rawValue == second }
  val rest = parts.drop(if (scope == null && !searching) 1 else 2)
  if (rest.size > 1) return null
  return ArgusRoute.Issues(
    scope = scope ?: LinearIssueScope.assigned,
    issue = rest.firstOrNull(),
    query = if (searching) query["q"]?.trim()?.ifEmpty { null } else null,
  )
}

private fun parseSession(parts: List<String>, query: Map<String, String>): ArgusRoute? {
  val count = parts.size
  if (count == 2) return ArgusRoute.Session(parts[1]) // A session's home is gone; old links land on its agents.
  if (count < 3) return null
  val id = parts[1]
  return when (parts[2]) {
    "home" -> ArgusRoute.Session(id)
    "agents" -> ArgusRoute.Session(id, parts.getOrNull(3))
    "git" -> GitRoute.parse(parts.drop(3), query)?.let { ArgusRoute.SessionGit(id, it) }
    "code" -> if (count == 3) {
      val path = query["path"].nonEmpty()
      ArgusRoute.SessionCode(id, path, if (path == null) null else query["line"]?.toIntOrNull())
    } else {
      null
    }
    else -> null
  }
}

internal fun parseGitRoute(segments: List<String>, query: Map<String, String>): GitRoute? {
  val ref = segments.drop(1).joinToString("/").ifEmpty { null }
  return when (segments.firstOrNull()) {
    null, "working" -> GitRoute.Working
    "branch" -> GitRoute.Branch
    "history" -> GitRoute.History
    "stashes" -> GitRoute.Stashes
    "reflog" -> GitRoute.Reflog
    "conflicts" -> GitRoute.Conflicts
    "branches" -> GitRoute.Branches(ref)
    "tags" -> ref?.let { GitRoute.Tags(it) } ?: GitRoute.History
    "submodules" -> GitRoute.Submodules
    "bisect" -> GitRoute.Bisect
    "hooks" -> GitRoute.Hooks
    "compare" -> GitRoute.Compare(query["left"] ?: "", query["right"] ?: "")
    "blame" -> GitRoute.Blame(query["path"].nonEmpty(), query["ref"].nonEmpty())
    "settings" -> GitRoute.Settings
    "pull-requests" -> GitRoute.PullRequests
    "branches-review" -> GitRoute.BranchesReview
    "interactive-rebase" -> GitRoute.InteractiveRebase(query["from"] ?: "")
    "guide" -> GitRoute.Guide
    "timeline" -> GitRoute.Timeline(query["turn"].nonEmpty())
    else -> null
  }
}

internal fun gitPathSuffix(route: GitRoute): String = when (route) {
  is GitRoute.Branches -> route.name?.let { "branches/${encodeSegment(it)}" } ?: route.segment
  is GitRoute.Tags -> "tags/${encodeSegment(route.name)}"
  is GitRoute.Compare -> "compare" + ArgusRoute.query("left" to route.left, "right" to route.right)
  is GitRoute.Blame -> "blame" + ArgusRoute.query("path" to route.path, "ref" to route.ref)
  is GitRoute.InteractiveRebase -> "interactive-rebase" + ArgusRoute.query("from" to route.from)
  is GitRoute.Timeline -> "timeline" + ArgusRoute.query("turn" to route.turn)
  else -> route.segment
}

internal fun routePath(route: ArgusRoute): String {
  val e = ::encodeSegment
  return when (route) {
    ArgusRoute.Home -> "/"
    ArgusRoute.Agents -> "/agents"
    ArgusRoute.Runtimes -> "/runtimes"
    ArgusRoute.Devices -> "/devices"
    is ArgusRoute.Device -> "/devices/${e(route.platform)}/${e(route.deviceKey)}"
    is ArgusRoute.Inbox -> "/inbox" + q("automation" to route.filter.automationId, "project" to route.filter.project)
    is ArgusRoute.Proposal -> "/inbox/proposals/${e(route.id)}"
    ArgusRoute.Notifications -> "/notifications"
    is ArgusRoute.Usage ->
      route.pattern + q("range" to if (route.tab == UsageTab.Limits) null else route.range?.rawValue)
    is ArgusRoute.UsageModel ->
      "/usage/${route.tab.rawValue}/models/${e(route.runner)}/${e(route.model)}" +
        q("range" to route.range?.rawValue)
    ArgusRoute.UsagePrices -> "/usage/prices"
    ArgusRoute.UsageModels -> "/usage/models"
    is ArgusRoute.CompareRun -> "/compare/${e(route.groupId)}"
    ArgusRoute.PullRequests -> "/pull-requests"
    is ArgusRoute.PullRequest -> "/pull-requests/${route.repo}/${route.number}"
    is ArgusRoute.PullRequestGuide -> "/pull-requests/${route.repo}/${route.number}/guide"
    is ArgusRoute.Issues ->
      issuesBase(route.scope, route.query) + (route.issue?.let { "/${e(it)}" } ?: "") + q("q" to route.query)
    is ArgusRoute.Design -> "/design" + q("url" to route.url, "session" to route.session)
    ArgusRoute.Blueprints -> "/blueprints"
    is ArgusRoute.Blueprint -> "/blueprints/" + (route.id?.let(e) ?: "new")
    ArgusRoute.GenerateBlueprint -> "/blueprints/generate"
    is ArgusRoute.NewProject -> "/blueprints/new-project" + q("blueprint" to route.blueprintId)
    ArgusRoute.Automations -> "/automations"
    is ArgusRoute.QuickRun -> route.runId?.let { "/automations/quick/runs/${e(it)}" } ?: "/automations/quick"
    ArgusRoute.DescribeAutomation -> "/automations/describe"
    is ArgusRoute.Automation -> "/automations/${e(route.id)}" + (route.runId?.let { "/runs/${e(it)}" } ?: "")
    is ArgusRoute.Session -> "/sessions/${e(route.id)}/agents" + (route.agentId?.let { "/${e(it)}" } ?: "")
    is ArgusRoute.SessionGit -> "/sessions/${e(route.id)}/git/${route.view.pathSuffix}"
    is ArgusRoute.SessionCode ->
      "/sessions/${e(route.id)}/code" +
        q("path" to route.filePath, "line" to if (route.filePath == null) null else route.line?.toString())
  }
}

/** `argus://host/path?q` and `argus:path` alike: everything after the scheme becomes the path. */
internal fun deepLinkPath(url: String): String? {
  val colon = url.indexOf(':')
  if (colon < 0 || url.substring(0, colon) != "argus") return null
  return "/" + url.substring(colon + 1).removePrefix("//").substringBefore('#')
}

internal fun queryString(items: List<Pair<String, String?>>): String {
  val present = items.mapNotNull { (name, value) -> value?.let { "${encodeQuery(name)}=${encodeQuery(it)}" } }
  return if (present.isEmpty()) "" else "?" + present.joinToString("&")
}

internal fun splitPath(raw: String): Pair<String, Map<String, String>> {
  val mark = raw.indexOf('?')
  if (mark < 0) return raw to emptyMap()
  val query = LinkedHashMap<String, String>()
  for (item in raw.substring(mark + 1).split('&')) {
    if (item.isEmpty()) continue
    val name = percentDecode(item.substringBefore('=')) ?: return raw.substring(0, mark) to emptyMap()
    val value = if ('=' in item) percentDecode(item.substringAfter('=')) else ""
    if (value == null) return raw.substring(0, mark) to emptyMap()
    query.putIfAbsent(name, value)
  }
  return raw.substring(0, mark) to query
}

// Path segments keep RFC 3986's sub-delims and `:@`, minus the ones that would split a route.
private const val SEGMENT_SAFE = "-._~!$'()*+,;:@"

// Query values also keep `/` and `?`; `+` is escaped so form decoders can't read it as a space.
private const val QUERY_SAFE = "-._~!$'()*,;:@/?"

internal fun encodeSegment(segment: String): String = percentEncode(segment, SEGMENT_SAFE)

private fun encodeQuery(value: String): String = percentEncode(value, QUERY_SAFE)

private fun percentEncode(value: String, safe: String): String {
  val out = StringBuilder()
  for (byte in value.toByteArray(Charsets.UTF_8)) {
    val c = byte.toInt() and 0xFF
    val ch = c.toChar()
    if (c < 0x80 && (ch.isLetterOrDigit() || ch in safe)) out.append(ch) else out.append('%').append(HEX[c shr 4]).append(HEX[c and 0xF])
  }
  return out.toString()
}

private const val HEX = "0123456789ABCDEF"

/** Null when an escape is malformed or the bytes aren't UTF-8; `+` stays a plus. */
internal fun percentDecode(value: String): String? {
  if ('%' !in value) return value
  val bytes = ByteArrayOutputStream()
  var i = 0
  while (i < value.length) {
    if (value[i] == '%') {
      val hi = value.getOrNull(i + 1)?.digitToIntOrNull(16) ?: return null
      val lo = value.getOrNull(i + 2)?.digitToIntOrNull(16) ?: return null
      bytes.write(hi * 16 + lo)
      i += 3
    } else {
      val end = value.indexOf('%', i).let { if (it < 0) value.length else it }
      bytes.write(value.substring(i, end).toByteArray(Charsets.UTF_8))
      i = end
    }
  }
  return try {
    Charsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(bytes.toByteArray()))
      .toString()
  } catch (_: CharacterCodingException) {
    null
  }
}

private fun q(vararg items: Pair<String, String?>): String = queryString(items.toList())

private fun String?.nonEmpty(): String? = this?.ifEmpty { null }
