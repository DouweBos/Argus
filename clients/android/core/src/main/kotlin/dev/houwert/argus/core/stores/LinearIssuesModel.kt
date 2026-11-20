package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.kit.storage.Preferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/**
 * The Issues screen's list of Linear issues for one scope, or for a search of the whole
 * workspace. A change made in an issue's detail is passed back through [replace].
 * Mutate from the store's (main) dispatcher.
 */
class LinearIssuesModel(
  private val host: HostStore,
  /** Null keeps filters in memory only. */
  private val preferences: Preferences? = null,
) {
  private val _scope = MutableStateFlow(LinearIssueScope.assigned)
  val scope: StateFlow<LinearIssueScope> = _scope.asStateFlow()
  /** A search of the whole workspace, which wins over [scope]; null lists the scope. Set it to a [term]. */
  private val _query = MutableStateFlow<String?>(null)
  val query: StateFlow<String?> = _query.asStateFlow()
  /** Null until the first answer for this scope or search. */
  private val _issues = MutableStateFlow<List<LinearIssue>?>(null)
  val issues: StateFlow<List<LinearIssue>?> = _issues.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()
  private val _refreshing = MutableStateFlow(false)
  val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()
  /** The scope's active filters, like a saved Linear view; remembered per scope, and once for search. */
  private val _filters = MutableStateFlow(emptyList<IssueFilter>())
  val filters: StateFlow<List<IssueFilter>> = _filters.asStateFlow()
  /** [issues] after the filters: what the list shows. */
  private val _shownIssues = MutableStateFlow<List<LinearIssue>?>(null)
  val shownIssues: StateFlow<List<LinearIssue>?> = _shownIssues.asStateFlow()
  /** Every workflow state of the issues' teams, so a column can show with no issue in it yet. */
  private val _workflowStates = MutableStateFlow(emptyList<LinearWorkflowState>())
  val workflowStates: StateFlow<List<LinearWorkflowState>> = _workflowStates.asStateFlow()

  /** The first answer to each search, with how many it found: once per search, never per refresh. */
  var onSearched: ((Int) -> Unit)? = null

  private var reported = false
  private val statesByTeam = mutableMapOf<String, List<LinearWorkflowState>>()
  private val filtersByScope = load(preferences).toMutableMap()

  init {
    syncFilters()
  }

  private val filterKey: String get() = if (_query.value == null) _scope.value.rawValue else SEARCH_FILTER_KEY

  fun setScope(value: LinearIssueScope) {
    if (value == _scope.value) return
    _scope.value = value
    _issues.value = null
    _error.value = null
    syncFilters()
  }

  fun setQuery(value: String?) {
    if (value == _query.value) return
    _query.value = value
    _issues.value = null
    _error.value = null
    reported = false
    syncFilters()
  }

  fun setFilters(value: List<IssueFilter>) {
    filtersByScope[filterKey] = value
    save(filtersByScope, preferences)
    syncFilters()
  }

  private fun syncFilters() {
    _filters.value = filtersByScope[filterKey].orEmpty()
    _shownIssues.value = _issues.value?.let { IssueFilters.apply(it, _filters.value) }
  }

  private fun setIssues(value: List<LinearIssue>?) {
    _issues.value = value
    _shownIssues.value = value?.let { IssueFilters.apply(it, _filters.value) }
    _workflowStates.value = value.orEmpty().map { it.teamId }.toSortedSet().flatMap { statesByTeam[it].orEmpty() }
  }

  suspend fun refresh() {
    if (!host.linearConnected) {
      setIssues(null)
      _error.value = null
      return
    }
    val askedScope = _scope.value
    val askedQuery = _query.value
    fun current() = askedScope == _scope.value && askedQuery == _query.value
    _refreshing.value = true
    try {
      val found =
        if (askedQuery != null) host.linearIssues(askedQuery, limit = SEARCH_LIMIT)
        else host.linearIssues("", scope = askedScope, limit = 100)
      if (!current()) return
      setIssues(found)
      _error.value = null
      if (askedQuery != null && !reported) {
        reported = true
        onSearched?.invoke(found.size)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      if (!current()) return
      _error.value = HostStore.describe(e)
    } finally {
      _refreshing.value = false
    }
    loadWorkflowStates()
    // "Agent on it" needs every project's sessions, not just the ones opened.
    for (project in host.projects.value) host.loadSessions(project.repoRoot)
  }

  /** Once per team: workflows rarely change, and a failure leaves the list to the issues' own states. */
  private suspend fun loadWorkflowStates() {
    val teams = _issues.value.orEmpty().map { it.teamId }.toSortedSet() - statesByTeam.keys
    for (team in teams) {
      val states = runCatching { host.linearTeamStates(team) }.getOrNull()
      if (!states.isNullOrEmpty()) statesByTeam[team] = states
    }
    setIssues(_issues.value)
  }

  /** An issue as it now stands, after a change made from its detail. */
  fun replace(issue: LinearIssue) {
    val list = _issues.value ?: return
    if (list.none { it.id == issue.id }) return
    setIssues(list.map { if (it.id == issue.id) issue else it })
  }

  companion object {
    internal const val FILTERS_KEY = "issues.filters"
    internal const val SEARCH_FILTER_KEY = "search"
    /** A search asks for fewer than a scope: Linear ranks them, so the top ones are what's wanted. */
    const val SEARCH_LIMIT = 50

    private val filtersSerializer = MapSerializer(String.serializer(), ListSerializer(IssueFilter.serializer()))

    /** What's worth searching for: trimmed, null when nothing is left. */
    fun term(raw: String?): String? = raw?.trim()?.takeIf { it.isNotEmpty() }

    internal fun load(preferences: Preferences?): Map<String, List<IssueFilter>> =
      preferences?.decode(FILTERS_KEY, filtersSerializer).orEmpty()

    internal fun save(filters: Map<String, List<IssueFilter>>, preferences: Preferences?) {
      preferences?.encode(filters, filtersSerializer, FILTERS_KEY)
    }
  }
}

/**
 * One issue in full, and the changes the computer's connected Linear user can make to it:
 * status, priority and a comment.
 */
class LinearIssueDetailModel(
  val ref: String,
  private val host: HostStore,
  private val onChange: (LinearIssue) -> Unit = {},
) {
  private val _issue = MutableStateFlow<LinearIssueDetail?>(null)
  val issue: StateFlow<LinearIssueDetail?> = _issue.asStateFlow()
  /** Its team's workflow, for the status picker; empty until known. */
  private val _states = MutableStateFlow(emptyList<LinearWorkflowState>())
  val states: StateFlow<List<LinearWorkflowState>> = _states.asStateFlow()
  private val _loadError = MutableStateFlow<String?>(null)
  val loadError: StateFlow<String?> = _loadError.asStateFlow()
  /** The last change that failed. */
  private val _actionError = MutableStateFlow<String?>(null)
  val actionError: StateFlow<String?> = _actionError.asStateFlow()
  private val _updating = MutableStateFlow(false)
  val updating: StateFlow<Boolean> = _updating.asStateFlow()
  private val _posting = MutableStateFlow(false)
  val posting: StateFlow<Boolean> = _posting.asStateFlow()
  /** The thread a reply is being posted in; null for a new comment. */
  private val _postingIn = MutableStateFlow<String?>(null)
  val postingIn: StateFlow<String?> = _postingIn.asStateFlow()

  fun clearActionError() { _actionError.value = null }

  /** The picker's options: the workflow, or just the issue's own state until it loads. */
  val stateOptions: List<LinearWorkflowState>
    get() {
      val states = _states.value
      if (states.isNotEmpty()) return states.sortedBy { it.position }
      return _issue.value?.let { listOf(it.state) }.orEmpty()
    }

  suspend fun load() {
    try {
      val (found, states) = host.linearIssue(ref)
      _issue.value = found
      if (states.isNotEmpty()) _states.value = states
      _loadError.value = if (found == null) "Linear has no issue $ref." else null
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      _loadError.value = HostStore.describe(e)
    }
  }

  suspend fun setState(stateId: String) {
    val current = _issue.value ?: return
    if (current.state.id == stateId) return
    _states.value.firstOrNull { it.id == stateId }?.let { state -> _issue.value = current.copy(state = state) }
    update(stateId, null, current)
  }

  suspend fun setPriority(priority: Int) {
    val current = _issue.value ?: return
    if (current.priority.toInt() == priority) return
    _issue.value = current.copy(priority = priority.toDouble())
    update(null, priority, current)
  }

  /** True once posted, so the composer can clear. `parentId` replies in that thread. */
  suspend fun comment(body: String, parentId: String? = null): Boolean {
    val text = body.trim()
    val issue = _issue.value ?: return false
    if (text.isEmpty()) return false
    _posting.value = true
    _postingIn.value = parentId
    return try {
      host.commentOnLinearIssue(issue.id, text, parentId)
      _actionError.value = null
      load()
      true
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      _actionError.value = HostStore.describe(e)
      false
    } finally {
      _posting.value = false
      _postingIn.value = null
    }
  }

  private suspend fun update(stateId: String?, priority: Int?, revert: LinearIssueDetail) {
    _updating.value = true
    try {
      val updated = host.updateLinearIssue(revert.id, stateId, priority)
      if (updated != null) {
        _issue.value = _issue.value?.copy(state = updated.state, priority = updated.priority, updatedAt = updated.updatedAt)
        onChange(updated)
      }
      _actionError.value = null
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      _issue.value = revert
      _actionError.value = HostStore.describe(e)
    } finally {
      _updating.value = false
    }
  }
}
