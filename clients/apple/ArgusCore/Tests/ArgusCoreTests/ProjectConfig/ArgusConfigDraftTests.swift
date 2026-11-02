import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct ArgusConfigDraftTests {
  private func raw(_ json: String) throws -> [String: JSONValue] {
    try #require(try ConfigJSON.parse(json).objectValue)
  }

  @Test func keepsKeysItDoesNotOwn() throws {
    let file = try raw(#"{ "future_key": { "a": 1 }, "setup": { "copy": ["x"], "later": true } }"#)
    var draft = ArgusConfigDraft(raw: file)
    draft.browserUrl = "http://localhost:5173"
    let out = draft.applied(to: file)
    #expect(out["future_key"] == file["future_key"])
    #expect(out["setup"]?["later"] == .bool(true))
    #expect(out["setup"]?["copy"] == .array([.string("x")]))
    #expect(out["browser_url"] == .string("http://localhost:5173"))
  }

  @Test func roundTripsEveryOwnedField() throws {
    let file = try raw(
      #"""
      {
        "setup": { "copy": ["node_modules", { "path": ".claude", "exclude": ["projects/**"] }],
                   "symlink": [".env"], "commands": ["pnpm install"] },
        "terminals": [{ "name": "Shell", "dir": "." }],
        "run": [{ "title": "Dev", "command": "pnpm dev", "restartOnRerun": true, "requires": ["Api"] },
                { "title": "Api", "command": "pnpm api", "cwd": "api", "restartOnRerun": false }],
        "workspace_env": [{ "name": "PORT", "base_value": 1420, "range": 100, "strategy": "sequential" }],
        "related_projects": [{ "path": "../x", "description": "X" }],
        "browser_url": "http://localhost:3000",
        "browser_presets": [{ "id": "kiosk", "label": "Kiosk", "width": 1920, "height": 1080 }],
        "simulator_deeplinks": [{ "label": "P", "url": "app://p" },
                                { "label": "F", "children": [{ "label": "C", "url": "app://c" }] }],
        "save_chat_history": false,
        "auto_continue_on_limit": true,
        "protected_branches": ["main"],
        "pull_request_template": "feature.md",
        "default_base_branch": "staging",
        "single_runtime": true,
        "min_argus_version": "0.10.0",
        "mcp_servers": { "fs": { "command": "npx", "args": ["-y"] } },
        "auto_fetch_minutes": 15,
        "release_note_patterns": [{ "glob": "notes/*.txt", "format": "regex",
                                    "labels": [{ "name": "type", "selector": "^T:(.+)$", "tone": "accent" }] }],
        "llm": { "runner": "claude-code", "model": "opus" },
        "tools": { "disabled": ["device-debug"] },
        "automations": { "autonomy_ceiling": "draft", "disabled": ["a"], "path_denylist": ["infra/**"] }
      }
      """#)
    let draft = ArgusConfigDraft(raw: file)
    #expect(draft.applied(to: file) == file)
  }

  @Test func dropsRetiredKeys() throws {
    var file = try raw(#"{ "custom": 1 }"#)
    for key in ArgusConfigDraft.retiredKeys { file[key] = .string("old") }
    let out = ArgusConfigDraft(raw: file).applied(to: file)
    #expect(out == ["custom": .number(1), "setup": .object([:])])
  }

  @Test func appliesTheDesktopsDefaultsAndTrimming() {
    var draft = ArgusConfigDraft()
    draft.workspaceEnv = [.init(name: " PORT ", baseValue: "nope")]
    draft.browserPresets = [.init(key: "p")]
    draft.run = [.init(title: "Dev", command: ""), .init(title: " Up ", command: " go ")]
    draft.minArgusVersion = "v1.2.3"
    draft.deeplinks = [.init(label: "Empty", children: []), .init(label: "", url: "x://")]
    draft.saveChatHistory = true
    let out = draft.applied(to: [:])
    #expect(out["workspace_env"] == .array([.object(["name": .string("PORT"), "base_value": .number(8081)])]))
    #expect(out["browser_presets"]?.arrayValue?.first?["width"] == .number(375))
    #expect(out["browser_presets"]?.arrayValue?.first?["height"] == .number(667))
    #expect(out["run"]?.arrayValue?.count == 1)
    #expect(out["run"]?.arrayValue?.first?["title"] == .string("Up"))
    #expect(out["min_argus_version"] == .string("1.2.3"))
    #expect(out["simulator_deeplinks"] == nil)
    #expect(out["save_chat_history"] == nil)
    #expect(out["setup"] == .object([:]))
  }

  @Test func clearingAFieldRemovesItsKey() throws {
    let file = try raw(#"{ "browser_url": "http://x", "auto_fetch_minutes": 5, "llm": { "model": "m" } }"#)
    var draft = ArgusConfigDraft(raw: file)
    draft.browserUrl = "  "
    draft.autoFetchMinutes = 0
    draft.llmModel = ""
    let out = draft.applied(to: file)
    #expect(out["browser_url"] == nil)
    #expect(out["auto_fetch_minutes"] == nil)
    #expect(out["llm"] == nil)
  }

  @Test func bareReleaseGlobIsAChangesetsPattern() throws {
    let draft = ArgusConfigDraft(raw: try raw(#"{ "release_note_patterns": [".changeset/*.md"] }"#))
    #expect(draft.releaseNotes.first?.glob == ".changeset/*.md")
    #expect(draft.releaseNotes.first?.format == "changesets")
  }

  @Test func refusesInvalidMcpEntries() {
    var draft = ArgusConfigDraft()
    draft.mcpServers = [.init(name: "", json: "{}")]
    #expect(!draft.isValid)
    draft.mcpServers = [.init(name: "a", json: "[1]")]
    #expect(draft.mcpServers[0].error == "Config must be a JSON object.")
    draft.mcpServers = [.init(name: "a", json: "{ nope")]
    #expect(draft.mcpServers[0].error == "Invalid JSON.")
    draft.mcpServers = [.init(name: "a", json: #"{"url":"https://x"}"#)]
    #expect(draft.isValid)
  }

  @Test func writesDocumentedKeyOrderWithIntegers() {
    let text = ConfigJSON.string(
      .object([
        "zzz": .bool(true), "run": .array([.object(["restartOnRerun": .bool(true), "title": .string("a")])]),
        "setup": .object(["commands": .array([]), "copy": .array([.string("x")])]),
        "auto_fetch_minutes": .number(15),
      ]))
    #expect(
      text == """
        {
          "setup": {
            "copy": [
              "x"
            ],
            "commands": []
          },
          "run": [
            {
              "title": "a",
              "restartOnRerun": true
            }
          ],
          "auto_fetch_minutes": 15,
          "zzz": true
        }
        """)
  }

  @Test func escapesStrings() {
    #expect(ConfigJSON.quoted("a\"b\\c\nd\u{01}") == #""a\"b\\c\nd\u0001""#)
  }

  @Test func listsOtherRunTitlesAsRequirements() {
    var draft = ArgusConfigDraft()
    draft.run = [.init(title: "Dev"), .init(title: "Api"), .init(title: " ")]
    #expect(draft.requirableTitles(for: draft.run[0]) == ["Api"])
  }
}
