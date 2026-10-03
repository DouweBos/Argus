import ArgusKit
import Foundation

/// A custom runner being edited. The env map is an ordered list so a key
/// stays editable while it's typed; nothing reaches disk until it's saved.
public struct CustomRunnerDraft: Identifiable, Sendable {
  public struct EnvRow: Identifiable, Hashable, Sendable {
    public let id = UUID()
    public var key: String
    public var value: String

    public init(key: String = "", value: String = "") {
      self.key = key
      self.value = value
    }

    /// Values that look like credentials are masked until revealed.
    public var isSecret: Bool {
      key.range(of: "token|key|secret|password", options: [.regularExpression, .caseInsensitive])
        != nil
    }
  }

  public struct ModelRow: Identifiable, Hashable, Sendable {
    public let id = UUID()
    public var modelId: String
    public var displayName: String

    public init(modelId: String = "", displayName: String = "") {
      self.modelId = modelId
      self.displayName = displayName
    }
  }

  /// Stable for SwiftUI before the runner has a saved id.
  public let id = UUID()
  /// `custom:<slug>`, set by the host on first save and never changed.
  public var runnerId: String?
  public var displayName: String
  public var baseRunnerId: String
  public var envRows: [EnvRow]
  public var models: [ModelRow]
  public var defaultModel: String

  public init(
    runnerId: String? = nil, displayName: String, baseRunnerId: String, env: [String: String],
    models: [ArgusProtocol.CustomRunnerModel], defaultModel: String?
  ) {
    self.runnerId = runnerId
    self.displayName = displayName
    self.baseRunnerId = baseRunnerId
    envRows = env.sorted { $0.key < $1.key }.map { EnvRow(key: $0.key, value: $0.value) }
    self.models = models.map { ModelRow(modelId: $0.id, displayName: $0.displayName) }
    self.defaultModel = defaultModel ?? ""
  }

  public init(_ runner: ArgusProtocol.CustomRunner) {
    self.init(
      runnerId: runner.id, displayName: runner.displayName, baseRunnerId: runner.baseRunnerId,
      env: runner.env, models: runner.models, defaultModel: runner.defaultModel)
  }

  public init(preset: ArgusProtocol.CustomRunnerPresetDraft) {
    self.init(
      displayName: preset.displayName, baseRunnerId: preset.baseRunnerId, env: preset.env,
      models: preset.models, defaultModel: preset.defaultModel)
  }

  public var canSave: Bool {
    !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// Blank keys are dropped; an empty value is kept, since it unsets the var.
  public var env: [String: String] {
    var out: [String: String] = [:]
    for row in envRows {
      let key = row.key.trimmingCharacters(in: .whitespacesAndNewlines)
      if !key.isEmpty { out[key] = row.value }
    }
    return out
  }

  public var wireModels: [ArgusProtocol.CustomRunnerModel] {
    models.compactMap { row in
      let id = row.modelId.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !id.isEmpty else { return nil }
      return ArgusProtocol.CustomRunnerModel(id: id, displayName: row.displayName)
    }
  }

  public var wire: ArgusProtocol.CommandsTypes.LlmSaveCustomRunnerParamsRunner {
    let model = defaultModel.trimmingCharacters(in: .whitespacesAndNewlines)
    return .init(
      id: runnerId, displayName: displayName, baseRunnerId: baseRunnerId, env: env,
      models: wireModels, defaultModel: model.isEmpty ? nil : model)
  }
}
