package dev.houwert.argus.app.screens.git

import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import dev.houwert.argus.core.stores.CheckoutOutcome
import dev.houwert.argus.core.stores.DeleteBranchOutcome
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.PullStrategy
import dev.houwert.argus.core.stores.branchPullRequestUrl
import dev.houwert.argus.core.stores.checkoutBranch
import dev.houwert.argus.core.stores.createBranch
import dev.houwert.argus.core.stores.deleteBranch
import dev.houwert.argus.core.stores.mergeIntoCurrent
import dev.houwert.argus.core.stores.pullCurrent
import dev.houwert.argus.core.stores.pushBranch
import dev.houwert.argus.core.stores.rebaseCurrent
import dev.houwert.argus.core.stores.renameLocalBranch
import dev.houwert.argus.core.stores.setBranchPinned
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranch
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranchScope
import dev.houwert.argus.kit.protocol.ref
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * What the Mac's branch menu does, for any branch on a project root. The row menus and the
 * branch screen's chips all ask this; [BranchActionPrompts] shows its confirmations and sheets.
 */
class BranchActions(val sessionId: String, val repoRoot: String, private val host: HostStore, private val scope: CoroutineScope) {
  sealed interface Confirm {
    data class Merge(val squash: Boolean) : Confirm
    data object Rebase : Confirm
    data object ForcePush : Confirm
    data class Delete(val unmerged: Boolean) : Confirm
    data object Dirty : Confirm
  }

  class Prompt(val confirm: Confirm, val branch: RemoteGitBranch)

  sealed interface NameSheet {
    /** A new branch; [from] preselects its start point. */
    data class Create(val from: String?) : NameSheet
    data class Rename(val branch: RemoteGitBranch) : NameSheet
  }

  /** The checked-out branch, once known. */
  var current by mutableStateOf<String?>(null)
  /** Every branch, for the new-branch sheet's start points. */
  var branches by mutableStateOf(emptyList<RemoteGitBranch>())
  var busy by mutableStateOf(false)
    private set
  var prompt by mutableStateOf<Prompt?>(null)
  var nameSheet by mutableStateOf<NameSheet?>(null)

  var onChanged: suspend () -> Unit = {}
  var onRenamed: (RemoteGitBranch, String) -> Unit = { _, _ -> }
  var onDeleted: (RemoteGitBranch) -> Unit = {}

  val target: String get() = current ?: "the current branch"

  fun ask(confirm: Confirm, branch: RemoteGitBranch) { prompt = Prompt(confirm, branch) }
  fun newBranch(from: String? = null) { nameSheet = NameSheet.Create(from) }
  fun rename(branch: RemoteGitBranch) { nameSheet = NameSheet.Rename(branch) }

  internal fun run(action: suspend () -> Boolean) {
    busy = true
    scope.launch {
      if (action()) onChanged()
      busy = false
    }
  }

  fun checkout(branch: RemoteGitBranch, dirty: String? = null) {
    busy = true
    scope.launch {
      val outcome = host.checkoutBranch(sessionId, repoRoot, branch.name, dirty)
      busy = false
      when (outcome) {
        CheckoutOutcome.Dirty -> ask(Confirm.Dirty, branch)
        CheckoutOutcome.Ok -> onChanged()
        CheckoutOutcome.Failed -> Unit
      }
    }
  }

  fun push(branch: RemoteGitBranch, forceWithLease: Boolean = false) = run {
    host.pushBranch(sessionId, branch.name, null, setUpstream = branch.upstream == null, forceWithLease = forceWithLease)
  }

  fun pull(strategy: PullStrategy) = run { host.pullCurrent(sessionId, strategy) }

  fun setPinned(branch: RemoteGitBranch) = run { host.setBranchPinned(sessionId, branch.name, branch.pinned != true) }

  internal fun delete(branch: RemoteGitBranch, force: Boolean) {
    busy = true
    scope.launch {
      val outcome = host.deleteBranch(sessionId, branch.name, force)
      busy = false
      when (outcome) {
        DeleteBranchOutcome.Unmerged -> ask(Confirm.Delete(unmerged = true), branch)
        DeleteBranchOutcome.Ok -> {
          onDeleted(branch)
          onChanged()
        }
        DeleteBranchOutcome.Failed -> Unit
      }
    }
  }

  fun openPullRequest(branch: RemoteGitBranch, open: (String) -> Unit) {
    scope.launch {
      host.branchPullRequestUrl(sessionId, branch.name)?.let(open) ?: host.showError("This repo has no GitHub or GitLab remote.")
    }
  }

  internal fun create(name: String, from: String?, checkout: Boolean) {
    scope.launch {
      host.createBranch(sessionId, repoRoot, name, checkout, from)
      onChanged()
    }
  }

  internal fun rename(branch: RemoteGitBranch, to: String) {
    scope.launch {
      if (host.renameLocalBranch(sessionId, branch.name, to)) {
        onRenamed(branch, to)
        onChanged()
      }
    }
  }

  internal fun mergeIntoCurrent(branch: RemoteGitBranch, squash: Boolean) = run { host.mergeIntoCurrent(sessionId, branch.ref, squash) }

  internal fun rebaseOnto(branch: RemoteGitBranch) = run { host.rebaseCurrent(sessionId, branch.ref) }
}

/** One entry in a branch menu: a row, a divider, or a submenu flattened into its rows. */
sealed interface BranchMenuEntry {
  class Item(val label: String, val icon: ImageVector?, val destructive: Boolean = false, val enabled: Boolean = true, val run: () -> Unit) : BranchMenuEntry
  data object Divider : BranchMenuEntry
}

/** The menu's sections, in the Mac's branch-menu order, shared by the row menu and the branch screen. */
class BranchMenuSections(
  private val branch: RemoteGitBranch,
  private val actions: BranchActions,
  private val openUri: (String) -> Unit,
  private val copy: (String) -> Unit,
  private val onCompare: (() -> Unit)?,
) {
  private val isLocal = branch.scope == RemoteGitBranchScope.local
  private fun item(label: String, icon: ImageVector?, destructive: Boolean = false, enabled: Boolean = true, run: () -> Unit) =
    BranchMenuEntry.Item(label, icon, destructive, enabled, run)

  val checkout: List<BranchMenuEntry>
    get() = listOf(
      item(if (branch.isCurrent) "Checked out" else if (isLocal) "Switch to" else "Check out locally", Icons.branch, enabled = !branch.isCurrent) {
        actions.checkout(branch)
      },
    )

  val newBranch: List<BranchMenuEntry> get() = listOf(item("New branch from ${branch.name}", Icons.plus) { actions.newBranch(branch.ref) })

  val integrate: List<BranchMenuEntry>
    get() = if (branch.isCurrent) emptyList() else buildList {
      add(item("Merge into ${actions.target}", Icons.merge) { actions.ask(BranchActions.Confirm.Merge(false), branch) })
      add(item("Squash into ${actions.target}", Icons.stacked) { actions.ask(BranchActions.Confirm.Merge(true), branch) })
      add(item("Rebase ${actions.target} onto this", SfSymbol["arrow.triangle.swap"]) { actions.ask(BranchActions.Confirm.Rebase, branch) })
      onCompare?.let { add(item("Compare with ${actions.target}", SfSymbol["arrow.left.arrow.right"], run = it)) }
    }

  val remote: List<BranchMenuEntry>
    get() = buildList {
      if (isLocal) {
        add(item(if (branch.upstream == null) "Publish" else "Push", Icons.push) { actions.push(branch) })
        if (branch.upstream != null) {
          add(item("Force push", SfSymbol["exclamationmark.arrow.triangle.2.circlepath"]) { actions.ask(BranchActions.Confirm.ForcePush, branch) })
        }
      }
      if (branch.isCurrent && branch.upstream != null) {
        for (strategy in PullStrategy.entries) add(item("Pull: ${strategy.label}", SfSymbol["arrow.down.circle"]) { actions.pull(strategy) })
      }
      if (branch.upstream != null || branch.scope == RemoteGitBranchScope.remote) {
        add(item("Open pull request", Icons.pullRequest) { actions.openPullRequest(branch, openUri) })
      }
    }

  val manage: List<BranchMenuEntry>
    get() = buildList {
      if (isLocal) {
        add(item(if (branch.pinned == true) "Unpin" else "Pin", Icons.pin) { actions.setPinned(branch) })
        add(item("Rename", Icons.pencil) { actions.rename(branch) })
      }
      add(item("Copy name", Icons.copy) { copy(branch.name) })
      if (isLocal && !branch.isCurrent) {
        add(BranchMenuEntry.Divider)
        add(item("Delete", Icons.trash, destructive = true) { actions.ask(BranchActions.Confirm.Delete(false), branch) })
      }
    }

  /** Everything, for a row's long-press menu. */
  val all: List<BranchMenuEntry>
    get() = listOf(checkout, newBranch, integrate, remote, manage).filter { it.isNotEmpty() }
      .flatMapIndexed { i, section -> if (i == 0) section else listOf(BranchMenuEntry.Divider) + section }
}

/** A branch menu's rows inside a `DropdownMenu`; [close] dismisses it before the action runs. */
@Composable
fun BranchMenuItems(entries: List<BranchMenuEntry>, close: () -> Unit) {
  val theme = ArgusTheme.colors
  for (entry in entries) {
    when (entry) {
      BranchMenuEntry.Divider -> HorizontalDivider(color = theme.border)
      is BranchMenuEntry.Item -> DropdownMenuItem(
        text = { Text(entry.label, style = argusFont(15), color = if (entry.destructive) theme.error else theme.text) },
        leadingIcon = entry.icon?.let { { Icon(it, null, tint = if (entry.destructive) theme.error else theme.textSecondary) } },
        enabled = entry.enabled,
        onClick = {
          close()
          entry.run()
        },
      )
    }
  }
}

@Composable
fun rememberBranchMenu(actions: BranchActions): (RemoteGitBranch, (() -> Unit)?) -> BranchMenuSections {
  val uri = LocalUriHandler.current
  val clipboard = LocalClipboardManager.current
  return { branch, onCompare ->
    BranchMenuSections(branch, actions, { runCatching { uri.openUri(it) } }, { clipboard.setText(AnnotatedString(it)) }, onCompare)
  }
}

/** The confirmations and name sheets [actions] asks for. */
@Composable
fun BranchActionPrompts(actions: BranchActions) {
  actions.prompt?.let { prompt ->
    val branch = prompt.branch
    val target = actions.target
    val dismiss = { actions.prompt = null }
    when (val confirm = prompt.confirm) {
      is BranchActions.Confirm.Merge -> ConfirmDialog(
        if (confirm.squash) "Squash ${branch.name} into $target?" else "Merge ${branch.name} into $target?",
        "If it stops on conflicts, resolve them on the computer.", if (confirm.squash) "Squash" else "Merge", onDismiss = dismiss,
      ) { actions.mergeIntoCurrent(branch, confirm.squash) }
      BranchActions.Confirm.Rebase -> ConfirmDialog(
        "Rebase $target onto ${branch.name}?",
        "This rewrites $target's commits. If it stops on conflicts, resolve them on the computer.", "Rebase", destructive = true, onDismiss = dismiss,
      ) { actions.rebaseOnto(branch) }
      BranchActions.Confirm.ForcePush -> ConfirmDialog(
        "Force push ${branch.name}?", "Overwrites the remote branch, unless someone pushed since you last fetched.", "Force push",
        destructive = true, onDismiss = dismiss,
      ) { actions.push(branch, forceWithLease = true) }
      is BranchActions.Confirm.Delete -> ConfirmDialog(
        if (confirm.unmerged) "${branch.name} isn't fully merged" else "Delete ${branch.name}?",
        if (confirm.unmerged) "It has commits that aren't on any other branch. Deleting it loses them." else "This deletes the local branch.",
        if (confirm.unmerged) "Delete anyway" else "Delete", destructive = true, onDismiss = dismiss,
      ) { actions.delete(branch, force = confirm.unmerged) }
      BranchActions.Confirm.Dirty -> ConfirmDialog(
        "Uncommitted changes", "Switching to ${branch.name} would overwrite local changes.", "Stash and switch", onDismiss = dismiss,
      ) { actions.checkout(branch, dirty = "stash") }
    }
  }
  when (val sheet = actions.nameSheet) {
    is BranchActions.NameSheet.Create -> NewBranchSheet(actions, sheet.from ?: actions.current) { actions.nameSheet = null }
    is BranchActions.NameSheet.Rename -> TextSheet(
      "Rename ${sheet.branch.name}", "Save", initial = sheet.branch.name, placeholder = "new-branch-name", multiline = false, mono = true,
      allowsUnchanged = false, onDismiss = { actions.nameSheet = null },
    ) { actions.rename(sheet.branch, it) }
    null -> Unit
  }
}

/** New branch, as the Mac's sheet: a name, what it starts from, and whether to check it out. */
@Composable
private fun NewBranchSheet(actions: BranchActions, startPoint: String?, onDismiss: () -> Unit) {
  var name by rememberSaveable { mutableStateOf("") }
  var start by rememberSaveable { mutableStateOf(startPoint ?: "") }
  var checkout by rememberSaveable { mutableStateOf(true) }
  val trimmed = name.trim()
  // Local branches first, then remote-only ones, each by its git ref.
  val refs = actions.branches.filter { it.scope == RemoteGitBranchScope.local }.map { it.ref } +
    actions.branches.filter { it.scope == RemoteGitBranchScope.remote }.map { it.ref }
  val all = if (start.isEmpty() || start in refs) refs else listOf(start) + refs
  FormSheet("New branch", "Create", confirmEnabled = trimmed.isNotEmpty(), onDismiss = onDismiss, onConfirm = {
    onDismiss()
    actions.create(trimmed, start.ifEmpty { null }, checkout)
  }) {
    Field("Branch name") { ThemedTextField(name, { name = it }, "new-branch-name", mono = true, input = TextInput.Code) }
    Field("From", caption = if (start.isEmpty()) "Whatever is checked out now." else null) {
      MenuChip(
        "From", start, listOf(PickerOption("", "Checked-out branch")) + all.map { PickerOption(it, it) }, { start = it },
        icon = Icons.branch, mono = start.isNotEmpty(),
      )
    }
    ToggleRow("Check out after creating", checkout) { checkout = it }
  }
}

@Composable
private fun ToggleRow(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
  androidx.compose.foundation.layout.Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
    MutedText(label, androidx.compose.ui.Modifier.weight(1f))
    dev.houwert.argus.ui.components.ArgusSwitch(on, onChange)
  }
}
