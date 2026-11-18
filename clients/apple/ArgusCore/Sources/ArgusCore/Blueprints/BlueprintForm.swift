import ArgusKit
import Foundation

/// A blueprint as the editors hold it: every field plain and editable, built
/// from a saved blueprint, a generated draft or nothing, and turned back into
/// the wire input on save. Shared by the Mac and the phone.
public struct BlueprintForm: Equatable, Sendable {
  public struct Reference: Equatable, Sendable, Identifiable {
    public var path: String
    public var note: String
    public var id: String { path }

    public init(path: String, note: String = "") {
      self.path = path
      self.note = note
    }

    public var name: String { (path as NSString).lastPathComponent }
  }

  public enum ScaffoldKind: String, CaseIterable, Sendable {
    case empty
    case githubTemplate

    public var label: String {
      switch self {
      case .empty: "Empty Repository"
      case .githubTemplate: "GitHub Template"
      }
    }
  }

  public enum Visibility: String, CaseIterable, Sendable {
    case `private`
    case `public`

    public var label: String { rawValue.capitalized }
  }

  public var name = ""
  public var summary = ""
  public var parentDir = "~/Work"
  public var references: [Reference] = []
  public var scaffold: ScaffoldKind = .empty
  public var templateRepo = ""
  public var githubEnabled = true
  public var owner = ""
  public var visibility: Visibility = .private
  /// One of the references' paths, or nil.
  public var copySettingsFrom: String?
  public var instructions = ""
  public var runner: String?
  public var model: String?
  public var permissionMode: String?
  /// Came from a generated draft, so saving it is counted as a kept draft.
  public var fromDraft = false

  public init() {}

  public init(_ blueprint: ArgusProtocol.Blueprint) {
    name = blueprint.name
    summary = blueprint.summary
    parentDir = blueprint.parentDir
    references = blueprint.references.map { Reference(path: $0.path, note: $0.note) }
    (scaffold, templateRepo) = Self.scaffold(blueprint.scaffold)
    githubEnabled = blueprint.github.enabled
    owner = blueprint.github.owner
    visibility = Visibility(rawValue: blueprint.github.visibility.rawValue) ?? .private
    copySettingsFrom = blueprint.copyProjectSettingsFrom
    instructions = blueprint.instructions
    runner = blueprint.agent.runner
    model = blueprint.agent.model
    permissionMode = blueprint.agent.permissionMode?.rawValue
  }

  public init(_ draft: ArgusProtocol.BlueprintDraft) {
    name = draft.name
    summary = draft.summary
    parentDir = draft.parentDir
    references = draft.references.map { Reference(path: $0.path, note: $0.note) }
    (scaffold, templateRepo) = Self.scaffold(draft.scaffold)
    githubEnabled = draft.github.enabled
    owner = draft.github.owner
    visibility = Visibility(rawValue: draft.github.visibility.rawValue) ?? .private
    copySettingsFrom = draft.copyProjectSettingsFrom
    instructions = draft.instructions
    fromDraft = true
  }

  private static func scaffold(_ scaffold: ArgusProtocol.BlueprintScaffold) -> (ScaffoldKind, String) {
    if case .githubTemplate(let template) = scaffold { return (.githubTemplate, template.repo) }
    return (.empty, "")
  }

  /// Why it can't be saved yet, or nil.
  public var problem: String? {
    if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Give the blueprint a name." }
    if parentDir.trimmingCharacters(in: .whitespaces).isEmpty { return "Choose a folder for new projects." }
    if scaffold == .githubTemplate && !templateRepo.contains("/") {
      return "Enter the template repository as owner/name."
    }
    return nil
  }

  public mutating func addReference(_ path: String) {
    guard !references.contains(where: { $0.path == path }) else { return }
    references.append(Reference(path: path))
  }

  public mutating func removeReference(_ path: String) {
    references.removeAll { $0.path == path }
    if copySettingsFrom == path { copySettingsFrom = nil }
  }

  private var wireScaffold: ArgusProtocol.BlueprintScaffold {
    switch scaffold {
    case .empty: .empty(.init(kind: "empty"))
    case .githubTemplate:
      .githubTemplate(.init(kind: "github_template", repo: templateRepo.trimmingCharacters(in: .whitespaces)))
    }
  }

  private var wireGithub: ArgusProtocol.BlueprintGithub {
    .init(
      enabled: githubEnabled, owner: owner.trimmingCharacters(in: .whitespaces),
      visibility: .init(rawValue: visibility.rawValue))
  }

  private var wireAgent: ArgusProtocol.BlueprintAgent {
    .init(runner: runner, model: model, permissionMode: permissionMode.map { .init(rawValue: $0) })
  }

  private var wireReferences: [ArgusProtocol.BlueprintReference] {
    references.map { .init(path: $0.path, note: $0.note) }
  }

  public var createInput: ArgusProtocol.CreateBlueprintInput {
    .init(
      name: name, summary: summary, parentDir: parentDir, references: wireReferences, scaffold: wireScaffold,
      github: wireGithub, copyProjectSettingsFrom: copySettingsFrom, instructions: instructions, agent: wireAgent,
      fromDraft: fromDraft ? true : nil)
  }

  /// Every field; an empty string clears the settings source, which a patch can't null.
  public var updateInput: ArgusProtocol.UpdateBlueprintInput {
    .init(
      name: name, summary: summary, parentDir: parentDir, references: wireReferences, scaffold: wireScaffold,
      github: wireGithub, copyProjectSettingsFrom: copySettingsFrom ?? "", instructions: instructions,
      agent: wireAgent)
  }
}

extension ArgusProtocol.BlueprintStepKey {
  public var label: String {
    switch self {
    case .validate: "Check"
    case .createRepo: "Create repository"
    case .register: "Add to Argus"
    case .startAgent: "Start agent"
    default: rawValue
    }
  }
}

extension ArgusProtocol.Blueprint {
  public var scaffoldLabel: String {
    if case .githubTemplate(let template) = scaffold { return "Template \(template.repo)" }
    return "Empty repository"
  }
}

extension ArgusProtocol.BlueprintRun {
  public var isRunning: Bool { status == .running }
  public var failedStep: ArgusProtocol.BlueprintStep? { steps.first { $0.status == .failed } }
}
