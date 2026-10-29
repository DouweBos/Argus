import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@Suite("Model name")
struct ModelNameTests {
  @Test("a Claude model id reads as its family and version")
  func pretty() {
    #expect(ModelName.pretty("claude-opus-5-5") == "Claude Opus 5.5")
    #expect(ModelName.pretty("claude-opus-4-7[1m]") == "Claude Opus 4.7")
    #expect(ModelName.pretty("claude-sonnet-4-5-20250929") == "Claude Sonnet 4.5")
    #expect(ModelName.pretty("claude-opus-5") == "Claude Opus 5")
  }

  @Test("anything else isn't guessed at")
  func notClaude() {
    #expect(ModelName.pretty("opus") == nil)
    #expect(ModelName.pretty("default") == nil)
    #expect(ModelName.pretty("claude-3-5-sonnet-20241022") == nil)
    #expect(ModelName.pretty("callstack/Apex") == nil)
  }

  @Test("an alias shows the model it resolves to, the default included")
  func label() throws {
    let json = """
      [{"value": "default", "displayName": "Default (recommended)", "description": "",
        "resolvedModel": "claude-opus-5-5"},
       {"value": "sonnet", "displayName": "Sonnet", "description": ""}]
      """
    let models = try JSONDecoder().decode([RemoteModelInfo].self, from: Data(json.utf8))
    #expect(ModelName.label(for: nil, in: models) == "Claude Opus 5.5")
    #expect(ModelName.label(for: "sonnet", in: models) == "Sonnet")
    #expect(ModelName.label(for: "claude-haiku-4-5", in: models) == "Claude Haiku 4.5")
    #expect(ModelName.label(for: "custom", in: models) == "custom")
    #expect(ModelName.label(for: nil, in: []) == nil)
  }
}
