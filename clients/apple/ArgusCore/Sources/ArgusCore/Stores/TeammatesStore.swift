import ArgusKit
import Foundation
import Observation

/// The connected computer's teammates: who they are, their duties, their
/// memory and their conversations. The host records what changes, so this
/// store sends no telemetry of its own.
@MainActor
@Observable
public final class TeammatesStore {
  public typealias Summary = ArgusProtocol.TeammateSummary
  public typealias Teammate = ArgusProtocol.Teammate
  public typealias Detail = ArgusProtocol.MethodsTypes.TeammatesGetResult
  public typealias Thread = ArgusProtocol.TeammateThread
  public typealias Template = ArgusProtocol.RemoteTeammateTemplate

  public internal(set) var summaries: [Summary] = []
  public internal(set) var detailById: [String: Detail] = [:]
  public internal(set) var threadsById: [String: [Thread]] = [:]
  public internal(set) var memoriesById: [String: [RemoteAutomationMemory]] = [:]
  public internal(set) var templates: [Template] = []
  public internal(set) var loaded = false
  public internal(set) var error: String?

  unowned let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public func clear() {
    summaries = []
    detailById = [:]
    threadsById = [:]
    memoriesById = [:]
    templates = []
    loaded = false
    error = nil
  }

  public var phase: LoadPhase {
    LoadPhase(loaded: loaded, error: error, isEmpty: summaries.isEmpty)
  }

  public func teammate(_ id: String) -> Teammate? {
    detailById[id]?.teammate ?? summaries.first { $0.teammate.id == id }?.teammate
  }

  // MARK: Reading

  public func refresh() async {
    guard let backend = host.backend else { return }
    do {
      summaries = try await backend.request(ArgusProtocol.Methods.TeammatesList.self, .init()).teammates
      error = nil
    } catch {
      if Task.isCancelled { return }
      fail("Couldn't read teammates", error)
    }
    loaded = true
  }

  @discardableResult
  public func loadDetail(id: String) async -> Detail? {
    guard let backend = host.backend else { return nil }
    do {
      let detail = try await backend.request(
        ArgusProtocol.Methods.TeammatesGet.self, .init(teammateId: id))
      detailById[id] = detail
      return detail
    } catch {
      fail("Couldn't read that teammate", error)
      return nil
    }
  }

  public func loadTemplates() async {
    guard let backend = host.backend, templates.isEmpty else { return }
    if let result = try? await backend.request(ArgusProtocol.Methods.TeammatesTemplates.self, .init()) {
      templates = result.templates
    }
  }

  public func loadThreads(teammateId: String) async {
    guard let backend = host.backend else { return }
    if let result = try? await backend.request(
      ArgusProtocol.Methods.TeammatesThreads.self, .init(teammateId: teammateId))
    {
      threadsById[teammateId] = result.threads
    }
  }

  public func loadMemories(teammateId: String) async {
    guard let backend = host.backend else { return }
    struct Params: Encodable { let teammate_id: String }
    struct Result: Decodable { let memories: [RemoteAutomationMemory] }
    do {
      memoriesById[teammateId] = try await backend.request(
        .teammatesMemories, Params(teammate_id: teammateId), as: Result.self
      ).memories
    } catch {
      fail("Couldn't read that teammate's memory", error)
    }
  }

  // MARK: Conversations

  /// The thread to talk in, with its agent started or woken. Nil `threadId`
  /// is the newest; `fresh` starts a new one.
  public func openThread(
    teammateId: String, threadId: String? = nil, fresh: Bool = false
  ) async -> ArgusProtocol.OpenedTeammateThread? {
    guard let backend = host.backend else { return nil }
    do {
      let opened = try await backend.request(
        ArgusProtocol.Methods.TeammatesOpenThread.self,
        .init(teammateId: teammateId, threadId: threadId, fresh: fresh ? true : nil))
      await loadThreads(teammateId: teammateId)
      return opened
    } catch {
      fail("Couldn't open the conversation", error)
      return nil
    }
  }

  public func archiveThread(teammateId: String, threadId: String) async {
    guard let backend = host.backend else { return }
    do {
      _ = try await backend.request(
        ArgusProtocol.Methods.TeammatesArchiveThread.self, .init(threadId: threadId))
      threadsById[teammateId]?.removeAll { $0.id == threadId }
    } catch {
      fail("Couldn't archive that conversation", error)
    }
  }

  // MARK: Authoring

  public func createFromTemplate(_ templateId: String, repoRoots: [String]) async -> Teammate? {
    guard let backend = host.backend else { return nil }
    do {
      let teammate = try await backend.request(
        ArgusProtocol.Methods.TeammatesCreateFromTemplate.self,
        .init(templateId: templateId, repoRoots: repoRoots)
      ).teammate
      await refresh()
      return teammate
    } catch {
      fail("Couldn't create that teammate", error)
      return nil
    }
  }

  public func create(_ input: ArgusProtocol.CreateTeammateInput) async -> Teammate? {
    guard let backend = host.backend else { return nil }
    do {
      let teammate = try await backend.request(
        ArgusProtocol.Methods.TeammatesCreate.self, .init(input: input)
      ).teammate
      await refresh()
      return teammate
    } catch {
      fail("Couldn't create that teammate", error)
      return nil
    }
  }

  @discardableResult
  public func update(
    _ id: String, _ patch: ArgusProtocol.UpdateTeammateInput,
    clear: [ArgusProtocol.TeammateClearableField] = []
  ) async -> Bool {
    guard let backend = host.backend else { return false }
    do {
      let teammate = try await backend.request(
        ArgusProtocol.Methods.TeammatesUpdate.self,
        .init(teammateId: id, patch: patch, clear: clear.isEmpty ? nil : clear)
      ).teammate
      detailById[id]?.teammate = teammate
      if let index = summaries.firstIndex(where: { $0.teammate.id == id }) {
        summaries[index].teammate = teammate
      }
      return true
    } catch {
      fail("Couldn't save that teammate", error)
      return false
    }
  }

  public func setEnabled(_ id: String, _ enabled: Bool) async {
    var patch = ArgusProtocol.UpdateTeammateInput()
    patch.enabled = enabled
    await update(id, patch)
  }

  @discardableResult
  public func saveSoul(_ id: String, soul: String) async -> Bool {
    guard let backend = host.backend else { return false }
    do {
      _ = try await backend.request(
        ArgusProtocol.Methods.TeammatesSaveSoul.self, .init(teammateId: id, soul: soul))
      detailById[id]?.soul = soul
      return true
    } catch {
      fail("Couldn't save the soul", error)
      return false
    }
  }

  /// A rewritten soul for the editor; nothing is saved. Nil on failure.
  public func reviseSoul(name: String, soul: String, instruction: String) async -> String? {
    guard let backend = host.backend else { return nil }
    do {
      return try await backend.request(
        ArgusProtocol.Methods.TeammatesReviseSoul.self,
        .init(name: name, soul: soul, instruction: instruction)
      ).soul
    } catch {
      fail("Couldn't rewrite the soul", error)
      return nil
    }
  }

  public func delete(_ id: String, keepDuties: Bool) async -> Bool {
    guard let backend = host.backend else { return false }
    do {
      _ = try await backend.request(
        ArgusProtocol.Methods.TeammatesDelete.self, .init(teammateId: id, keepDuties: keepDuties))
      summaries.removeAll { $0.teammate.id == id }
      detailById[id] = nil
      threadsById[id] = nil
      memoriesById[id] = nil
      return true
    } catch {
      fail("Couldn't delete that teammate", error)
      return false
    }
  }

  /// Make an automation a duty — of a new teammate named after it, when
  /// `teammateId` is nil. Its memories move with it.
  public func promote(automationId: String, into teammateId: String?) async -> Teammate? {
    guard let backend = host.backend else { return nil }
    do {
      let teammate = try await backend.request(
        ArgusProtocol.Methods.TeammatesPromote.self,
        .init(automationId: automationId, teammateId: teammateId)
      ).teammate
      await refresh()
      return teammate
    } catch {
      fail("Couldn't move that automation", error)
      return nil
    }
  }

  public func removeDuty(teammateId: String, automationId: String) async {
    guard let backend = host.backend else { return }
    do {
      _ = try await backend.request(
        ArgusProtocol.Methods.TeammatesRemoveDuty.self, .init(automationId: automationId))
      await loadDetail(id: teammateId)
    } catch {
      fail("Couldn't remove that duty", error)
    }
  }

  // MARK: Memory

  /// Create or overwrite; `previousName` renames.
  public func saveMemory(
    teammateId: String, memory: RemoteAutomationMemory, previousName: String?
  ) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Memory: Encodable {
      let name: String
      let description: String
      let type: RemoteAutomationMemory.Kind
      let body: String
      let previous_name: String?
    }
    struct Params: Encodable {
      let teammate_id: String
      let memory: Memory
    }
    do {
      try await backend.request(
        .teammatesSaveMemory,
        Params(
          teammate_id: teammateId,
          memory: Memory(
            name: memory.name, description: memory.description, type: memory.type,
            body: memory.body, previous_name: previousName)),
        as: IgnoredResult.self)
      await loadMemories(teammateId: teammateId)
      return true
    } catch {
      fail("Couldn't save that memory", error)
      return false
    }
  }

  public func deleteMemory(teammateId: String, name: String) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable {
      let teammate_id: String
      let name: String
    }
    do {
      try await backend.request(
        .teammatesDeleteMemory, Params(teammate_id: teammateId, name: name), as: IgnoredResult.self)
      memoriesById[teammateId]?.removeAll { $0.name == name }
      return true
    } catch {
      fail("Couldn't delete that memory", error)
      return false
    }
  }

  private func fail(_ summary: String, _ error: Error) {
    guard !HostStore.isQuiet(error) else { return }
    self.error = "\(summary) — \(HostStore.describe(error))"
    host.hooks.errorReported(error, "teammates")
  }
}

extension ArgusProtocol.TeammateSummary: @retroactive Identifiable {
  public var id: String { teammate.id }
}

extension ArgusProtocol.TeammateThread: @retroactive Identifiable {}

extension ArgusProtocol.RemoteTeammateTemplate: @retroactive Identifiable {}
