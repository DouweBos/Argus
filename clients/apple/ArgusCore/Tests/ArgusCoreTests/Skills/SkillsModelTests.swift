import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
struct SkillsModelTests {
  private func model(_ fixtures: [String: String] = GalleryFixtures.skillsList) async -> SkillsModel {
    let host = HostStore()
    await host.attach(GalleryBackend(fixtures))
    await host.refreshProjects()
    let model = SkillsModel(host: host)
    await model.refresh()
    return model
  }

  @Test("your skills come first, then one section per project, by name")
  func sections() async {
    let model = await model()
    #expect(model.skills.count == 12)
    #expect(model.sections.map(\.title) == ["Your Skills", "Argus", "houwert.dev", "react-native-client"])
    #expect(model.sections[0].skills.first?.name == "code-review")
    #expect(model.phase == .content)
  }

  @Test("labels say where a skill came from")
  func labels() async throws {
    let model = await model()
    let byName = Dictionary(uniqueKeysWithValues: model.skills.map { ($0.name, $0) })
    #expect(SkillsModel.sourceLabel(byName["code-review"]?.source) == "houwert/skills")
    #expect(SkillsModel.sourceLabel(byName["triage"]?.source) == "houwert/codex-skills")
    #expect(SkillsModel.sourceLabel(byName["release-notes"]?.source) == "Gist")
    #expect(SkillsModel.sourceLabel(byName["pdf"]?.source) == nil)
    #expect(SkillsModel.detail(try #require(byName["deploy-checklist"])) == "3 files")
  }

  @Test("an install over an existing skill stops to ask")
  func conflict() async {
    let skills = await model(GalleryFixtures.skillInstallConflict)
    let install = SkillInstallModel(skills: skills, url: "https://github.com/houwert/skills")
    #expect(install.canInstall)
    #expect(await install.install() == false)
    #expect(install.conflict == "code-review")
    #expect(install.error == nil)
  }

  @Test("a project skill needs a project")
  func needsProject() async {
    let install = SkillInstallModel(skills: await model(), url: "octo/skills")
    install.scope = .project
    #expect(!install.canInstall)
    install.repoRoot = install.projects.first?.repoRoot
    #expect(install.canInstall)
  }
}
