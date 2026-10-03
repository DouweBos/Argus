import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct AppPreferenceValuesTests {
  @Test func permissionModeMigratesClaudeNamesAndDefaultsToAuto() {
    #expect(DefaultPermissionMode.sanitize("acceptEdits") == .review)
    #expect(DefaultPermissionMode.sanitize("bypassPermissions") == .trusted)
    #expect(DefaultPermissionMode.sanitize("default") == .auto)
    #expect(DefaultPermissionMode.sanitize(nil) == .auto)
    #expect(DefaultPermissionMode.sanitize("plan") == .plan)
  }

  @Test func themeScaleAndConsentFallBackToDefaults() {
    #expect(ThemePreference.sanitize("purple") == .system)
    #expect(ThemePreference.sanitize("dark") == .dark)
    #expect(DisplaySize.sanitize(nil) == .default)
    #expect(DisplaySize.sanitize("smaller") == .smaller)
    #expect(TelemetryConsent.sanitize("off") == .presence)
    #expect(TelemetryConsent.sanitize("full") == .full)
  }

  @Test func customEditorsDropIncompleteEntries() throws {
    let data = try JSONSerialization.data(withJSONObject: [
      ["id": "a", "name": " Zed ", "command": "zed"],
      ["id": "b", "name": "", "command": "subl"],
      ["name": "No id", "command": "code"],
    ])
    #expect(CustomEditor.sanitize(data) == [CustomEditor(id: "a", name: "Zed", command: "zed")])
    #expect(CustomEditor.make(name: " ", command: "zed") == nil)
    let editor = try #require(CustomEditor.make(name: "Zed", command: " zed "))
    #expect(editor.command == "zed")
    #expect(editor.updated(name: "", command: "zed2") == CustomEditor(id: editor.id, name: "Zed", command: "zed2"))
  }
}

struct McpServerEntryTests {
  @Test func validatesNameAndObjectShape() {
    #expect(McpServerEntry(name: "", json: "{}").error == "Name is required.")
    #expect(McpServerEntry(name: "a", json: "[1]").error == "Config must be a JSON object.")
    #expect(McpServerEntry(name: "a", json: "{").error?.hasPrefix("Invalid JSON") == true)
    #expect(McpServerEntry(name: "a", json: McpServerEntry.sampleJSON).error == nil)
  }

  @Test func straightensCurlyQuotes() {
    let typed = "{\u{201C}url\u{201D}: \u{201C}it\u{2019}s\u{201D}}"
    #expect(McpServerEntry.straighteningQuotes(typed) == "{\"url\": \"it's\"}")
    #expect(McpServerEntry(name: "a", json: McpServerEntry.straighteningQuotes(typed)).error == nil)
  }

  @Test func roundTripsAndSkipsInvalidRows() {
    let map: [String: [String: JSONValue]] = ["http": ["url": .string("https://x.dev/mcp")]]
    let entries = McpServerEntry.entries(from: map) + [McpServerEntry(name: "bad", json: "{")]
    #expect(entries.first?.url == "https://x.dev/mcp")
    #expect(!McpServerEntry.allValid(entries))
    #expect(McpServerEntry.map(from: entries).keys.sorted() == ["http"])
  }
}

struct CustomRunnerDraftTests {
  @Test func masksCredentialLookingKeys() {
    #expect(CustomRunnerDraft.EnvRow(key: "ANTHROPIC_AUTH_TOKEN").isSecret)
    #expect(CustomRunnerDraft.EnvRow(key: "api_key").isSecret)
    #expect(!CustomRunnerDraft.EnvRow(key: "ANTHROPIC_BASE_URL").isSecret)
  }

  @Test func wireDropsBlankKeysButKeepsEmptyValues() {
    var draft = CustomRunnerDraft(
      displayName: "Apex", baseRunnerId: "claude-code", env: ["A": "1"],
      models: [.init(id: "callstack/Apex", displayName: "Apex")], defaultModel: "  ")
    draft.envRows.append(.init(key: " ", value: "x"))
    draft.envRows.append(.init(key: "UNSET", value: ""))
    draft.models.append(.init())
    let wire = draft.wire
    #expect(wire.env == ["A": "1", "UNSET": ""])
    #expect(wire.models?.map(\.id) == ["callstack/Apex"])
    #expect(wire.defaultModel == nil)
    #expect(draft.canSave)
  }
}

struct DesktopToolsTests {
  @Test func requirementsGateEffectiveState() {
    let toggles = ["device-control": false]
    #expect(DesktopTool.userEnabled("device-debug", in: toggles))
    #expect(!DesktopTool.effectivelyEnabled("device-debug", in: toggles))
    #expect(DesktopTool.missingRequirements("device-debug", in: toggles) == ["Device control (conductor)"])
    #expect(DesktopTool.effectivelyEnabled("device-inspector", in: [:]))
  }
}
