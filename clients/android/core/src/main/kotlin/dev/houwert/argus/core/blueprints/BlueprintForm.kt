package dev.houwert.argus.core.blueprints

import dev.houwert.argus.kit.protocol.generated.Blueprint
import dev.houwert.argus.kit.protocol.generated.BlueprintAgent
import dev.houwert.argus.kit.protocol.generated.BlueprintDraft
import dev.houwert.argus.kit.protocol.generated.BlueprintGithub
import dev.houwert.argus.kit.protocol.generated.BlueprintPermissionMode
import dev.houwert.argus.kit.protocol.generated.BlueprintReference
import dev.houwert.argus.kit.protocol.generated.BlueprintRun
import dev.houwert.argus.kit.protocol.generated.BlueprintRunStatus
import dev.houwert.argus.kit.protocol.generated.BlueprintScaffold
import dev.houwert.argus.kit.protocol.generated.BlueprintScaffoldEmpty
import dev.houwert.argus.kit.protocol.generated.BlueprintScaffoldGithubTemplate
import dev.houwert.argus.kit.protocol.generated.BlueprintStep
import dev.houwert.argus.kit.protocol.generated.BlueprintStepKey
import dev.houwert.argus.kit.protocol.generated.BlueprintStepStatus
import dev.houwert.argus.kit.protocol.generated.BlueprintVisibility
import dev.houwert.argus.kit.protocol.generated.CreateBlueprintInput
import dev.houwert.argus.kit.protocol.generated.UpdateBlueprintInput

/**
 * A blueprint as the editors hold it: every field plain and editable, built from
 * a saved blueprint, a generated draft or nothing, and turned back into the wire
 * input on save.
 */
data class BlueprintForm(
  val name: String = "",
  val summary: String = "",
  val parentDir: String = "~/Work",
  val references: List<Reference> = emptyList(),
  val scaffold: ScaffoldKind = ScaffoldKind.Empty,
  val templateRepo: String = "",
  val githubEnabled: Boolean = true,
  val owner: String = "",
  val visibility: Visibility = Visibility.Private,
  /** One of the references' paths, or null. */
  val copySettingsFrom: String? = null,
  val instructions: String = "",
  val runner: String? = null,
  val model: String? = null,
  val permissionMode: String? = null,
  /** Came from a generated draft, so saving it is counted as a kept draft. */
  val fromDraft: Boolean = false,
) {
  data class Reference(val path: String, val note: String = "") {
    val id: String get() = path
    val name: String get() = path.trimEnd('/').substringAfterLast('/')
  }

  enum class ScaffoldKind(val rawValue: String, val label: String) {
    Empty("empty", "Empty Repository"),
    GithubTemplate("githubTemplate", "GitHub Template"),
  }

  enum class Visibility(val rawValue: String, val label: String) {
    Private("private", "Private"),
    Public("public", "Public");

    companion object {
      fun fromRaw(raw: String) = entries.firstOrNull { it.rawValue == raw } ?: Private
    }
  }

  /** Why it can't be saved yet, or null. */
  val problem: String?
    get() = when {
      name.isBlank() -> "Give the blueprint a name."
      parentDir.isBlank() -> "Choose a folder for new projects."
      scaffold == ScaffoldKind.GithubTemplate && "/" !in templateRepo -> "Enter the template repository as owner/name."
      else -> null
    }

  fun addingReference(path: String): BlueprintForm =
    if (references.any { it.path == path }) this else copy(references = references + Reference(path))

  fun removingReference(path: String): BlueprintForm = copy(
    references = references.filter { it.path != path },
    copySettingsFrom = copySettingsFrom.takeIf { it != path },
  )

  private val wireScaffold: BlueprintScaffold
    get() = when (scaffold) {
      ScaffoldKind.Empty -> BlueprintScaffold.Empty(BlueprintScaffoldEmpty("empty"))
      ScaffoldKind.GithubTemplate -> BlueprintScaffold.GithubTemplate(BlueprintScaffoldGithubTemplate("github_template", templateRepo.trim()))
    }

  private val wireGithub get() = BlueprintGithub(githubEnabled, owner.trim(), BlueprintVisibility(visibility.rawValue))

  private val wireAgent get() = BlueprintAgent(runner, model, permissionMode?.let(::BlueprintPermissionMode))

  private val wireReferences get() = references.map { BlueprintReference(it.path, it.note) }

  val createInput: CreateBlueprintInput
    get() = CreateBlueprintInput(
      name = name, summary = summary, parentDir = parentDir, references = wireReferences, scaffold = wireScaffold,
      github = wireGithub, copyProjectSettingsFrom = copySettingsFrom, instructions = instructions, agent = wireAgent,
      fromDraft = if (fromDraft) true else null,
    )

  /** Every field; an empty string clears the settings source, which a patch can't null. */
  val updateInput: UpdateBlueprintInput
    get() = UpdateBlueprintInput(
      name = name, summary = summary, parentDir = parentDir, references = wireReferences, scaffold = wireScaffold,
      github = wireGithub, copyProjectSettingsFrom = copySettingsFrom ?: "", instructions = instructions, agent = wireAgent,
    )

  companion object {
    fun from(blueprint: Blueprint): BlueprintForm {
      val (kind, repo) = scaffoldOf(blueprint.scaffold)
      return BlueprintForm(
        name = blueprint.name, summary = blueprint.summary, parentDir = blueprint.parentDir,
        references = blueprint.references.map { Reference(it.path, it.note) }, scaffold = kind, templateRepo = repo,
        githubEnabled = blueprint.github.enabled, owner = blueprint.github.owner,
        visibility = Visibility.fromRaw(blueprint.github.visibility.rawValue), copySettingsFrom = blueprint.copyProjectSettingsFrom,
        instructions = blueprint.instructions, runner = blueprint.agent.runner, model = blueprint.agent.model,
        permissionMode = blueprint.agent.permissionMode?.rawValue,
      )
    }

    fun from(draft: BlueprintDraft): BlueprintForm {
      val (kind, repo) = scaffoldOf(draft.scaffold)
      return BlueprintForm(
        name = draft.name, summary = draft.summary, parentDir = draft.parentDir,
        references = draft.references.map { Reference(it.path, it.note) }, scaffold = kind, templateRepo = repo,
        githubEnabled = draft.github.enabled, owner = draft.github.owner,
        visibility = Visibility.fromRaw(draft.github.visibility.rawValue), copySettingsFrom = draft.copyProjectSettingsFrom,
        instructions = draft.instructions, fromDraft = true,
      )
    }

    private fun scaffoldOf(scaffold: BlueprintScaffold): Pair<ScaffoldKind, String> =
      if (scaffold is BlueprintScaffold.GithubTemplate) ScaffoldKind.GithubTemplate to scaffold.value.repo else ScaffoldKind.Empty to ""
  }
}

val BlueprintStepKey.label: String
  get() = when (this) {
    BlueprintStepKey.validate -> "Check"
    BlueprintStepKey.createRepo -> "Create repository"
    BlueprintStepKey.register -> "Add to Argus"
    BlueprintStepKey.startAgent -> "Start agent"
    else -> rawValue
  }

val Blueprint.scaffoldLabel: String
  get() = (scaffold as? BlueprintScaffold.GithubTemplate)?.let { "Template ${it.value.repo}" } ?: "Empty repository"

val BlueprintRun.isRunning: Boolean get() = status == BlueprintRunStatus.running

val BlueprintRun.failedStep: BlueprintStep? get() = steps.firstOrNull { it.status == BlueprintStepStatus.failed }
