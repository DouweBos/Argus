package dev.houwert.argus.core.skills

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.SkillScope
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

class SkillsModelTest {
  private fun skill(name: String, project: String? = null, source: String = "null", runner: String = "claude-code") =
    """{"path":"/s/$name","name":"$name","description":null,"scope":"${if (project == null) "user" else "project"}",""" +
      """"runner":"$runner","repo_root":${project?.let { "\"/p/$it\"" } ?: "null"},"project_name":${project?.let { "\"$it\"" } ?: "null"},""" +
      """"source":$source,"file_count":3}"""

  private val git =
    """{"kind":"git","location":"https://github.com/octo/skills/tree/main/review","subpath":"review","ref":"main","commit":"abc","installed_at":1,"updated_at":1}"""

  private suspend fun TestScope.model(): Pair<SkillsModel, FakeBackend> {
    val host = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(
      Methods.SkillsList,
      """{"skills":[${skill("zeta")},${skill("review", source = git)},${skill("lint", "tally")},${skill("triage", "argus", runner = "codex")}]}""",
    )
    attach(host, backend)
    return SkillsModel(host).also { it.refresh() } to backend
  }

  @Test fun groupsYourSkillsThenProjects() = runTest {
    val (model, _) = model()
    assertEquals(listOf("Your Skills", "argus", "tally"), model.sections().map { it.title })
    assertEquals(listOf("review", "zeta"), model.sections()[0].skills.map { it.name })
  }

  @Test fun labelsTheSource() = runTest {
    val (model, _) = model()
    val review = model.skills.value.first { it.name == "review" }
    assertEquals("octo/skills", SkillsModel.sourceLabel(review.source))
    assertTrue(SkillsModel.canUpdate(review))
    assertEquals("3 files", SkillsModel.detail(review))
    assertNull(SkillsModel.sourceLabel(model.skills.value.first { it.name == "zeta" }.source))
  }

  @Test fun removeDropsTheRow() = runTest {
    val (model, backend) = model()
    backend.reply(Methods.SkillsRemove, """{"removed":true}""")
    assertTrue(model.remove(model.skills.value.first { it.name == "zeta" }))
    assertFalse(model.skills.value.any { it.name == "zeta" })
  }

  @Test fun installStopsAtAConflictThenReplaces() = runTest {
    val (model, backend) = model()
    backend.reply(Methods.SkillsInstall, """{"status":"exists","name":"review","skill":null}""")
    val install = SkillInstallModel(model, "octo/skills")
    assertNull(install.install())
    assertEquals("review", install.conflict.value)
    backend.reply(Methods.SkillsInstall, """{"status":"installed","name":"review","skill":${skill("review", source = git)}}""")
    assertEquals("review", install.install()?.name)
    assertNull(install.conflict.value)
    assertEquals("Installed review.", model.notice.value)
  }

  @Test fun aProjectSkillNeedsAProject() = runTest {
    val (model, _) = model()
    val install = SkillInstallModel(model, "octo/skills")
    install.scope.value = SkillScope.project
    assertFalse(install.canInstall)
    install.repoRoot.value = "/p/tally"
    assertTrue(install.canInstall)
  }
}
