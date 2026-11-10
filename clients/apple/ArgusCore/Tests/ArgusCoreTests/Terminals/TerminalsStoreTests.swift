import ArgusCore
import Foundation
import Testing

@MainActor
struct TerminalsStoreTests {
  private func base64(_ text: String) -> String { Data(text.utf8).base64EncodedString() }

  private func makeStore(_ backend: RecordingBackend) -> TerminalsStore {
    TerminalsStore(backend: { backend })
  }

  @Test func reattachingReplaysScrollbackThenStreams() async {
    let backend = RecordingBackend()
    backend.reply("list_terminals", #"[{"id":"t1","sessionId":"s1","title":"Shell 1","runTitle":null,"exited":false,"exitCode":null}]"#)
    backend.reply("terminal_scrollback", #"{"data":"\#(base64("$ ls\r\n"))","truncated":false,"exited":false,"exitCode":null}"#)
    backend.responseSeq = 7
    let store = makeStore(backend)
    await store.refresh(sessionId: "s1")
    #expect(store.tabs("s1").map(\.title) == ["Shell 1"])
    #expect(backend.subscriptions.contains { $0.0 == "terminal:t1" && $0.1 })

    var shown = Data()
    var resets = 0
    let detach = store.attach("t1") { output in
      switch output {
      case .reset: resets += 1; shown = Data()
      case .data(let data): shown.append(data)
      case .exit: break
      }
    }
    #expect(await eventually { resets == 1 })
    store.ipc(channel: "terminal:data:t1", args: [.string(base64("dup"))], seq: 6)
    store.ipc(channel: "terminal:data:t1", args: [.string(base64("README"))], seq: 8)
    #expect(String(decoding: shown, as: UTF8.self) == "$ ls\r\nREADME")
    detach()
  }

  @Test func aShellThatExitsClosesButARunStaysReadable() async {
    let backend = RecordingBackend()
    backend.reply("create_terminal", #""t1""#)
    backend.reply("create_run_terminal", #"{"sessionId":"r1","started":true,"title":"dev","dependencies":[{"sessionId":"r0","title":"db"}]}"#)
    let store = makeStore(backend)
    await store.newShell(sessionId: "s1")
    await store.run("dev", sessionId: "s1")
    #expect(store.tabs("s1").map(\.id) == ["r0", "r1", "t1"])
    #expect(store.active("s1")?.id == "r1")
    #expect(store.running("dev", in: "s1")?.id == "r1")

    store.ipc(channel: "terminal:exit:t1", args: [.number(0)], seq: 1)
    store.ipc(channel: "terminal:exit:r1", args: [.number(1)], seq: 2)
    #expect(store.tabs("s1").map(\.id) == ["r0", "r1"])
    #expect(store.running("dev", in: "s1") == nil)
    #expect(store.tabs("s1").first { $0.id == "r1" }?.exitCode == 1)
  }

  @Test func startingARunDoesNotOpenADefaultShellOverIt() async {
    let backend = RecordingBackend()
    backend.reply("create_terminal", #""t1""#)
    backend.reply("list_terminals", #"[{"id":"r1","sessionId":"s1","title":"dev","runTitle":"dev","exited":false,"exitCode":null}]"#)
    backend.reply("create_run_terminal", #"{"sessionId":"r1","started":true,"title":"dev","dependencies":[]}"#)
    let store = makeStore(backend)
    await store.run("dev", sessionId: "s1")
    await store.open(sessionId: "s1", repoRoot: "/repo")
    #expect(store.tabs("s1").map(\.id) == ["r1"])
    #expect(store.active("s1")?.id == "r1")
  }

  @Test func aRunThatExitedBeforeTheSubscriptionShowsAsExited() async {
    let backend = RecordingBackend()
    backend.reply("create_run_terminal", #"{"sessionId":"r1","started":true,"title":"pwd","dependencies":[]}"#)
    backend.reply("terminal_scrollback", #"{"data":"","truncated":false,"exited":true,"exitCode":0}"#)
    let store = makeStore(backend)
    await store.run("pwd", sessionId: "s1")
    #expect(store.tabs("s1").first?.exitCode == 0)
    #expect(store.running("pwd", in: "s1") == nil)
  }

  @Test func anAgentsRunOpensItsTabAndAsksToBeShown() async {
    let store = makeStore(RecordingBackend())
    store.ipc(
      channel: "run:triggered",
      args: [.object([
        "sessionId": .string("s1"), "title": .string("dev"),
        "terminalSessionId": .string("r1"), "dependencies": .array([]),
      ])],
      seq: 1)
    #expect(await eventually { store.revealed?.sessionId == "s1" })
    #expect(store.running("dev", in: "s1")?.id == "r1")
  }

  @Test func conflictsAreOtherSessionsRunsInTheSameProject() async {
    let backend = RecordingBackend()
    backend.reply("create_run_terminal", #"{"sessionId":"r1","started":true,"title":"dev","dependencies":[]}"#)
    let store = makeStore(backend)
    await store.run("dev", sessionId: "other")
    #expect(store.conflicts(for: "s1", sessionsInRepo: ["s1", "other"]).map(\.terminalId) == ["r1"])
    #expect(store.conflicts(for: "s1", sessionsInRepo: ["s1"]).isEmpty)
  }

  @Test func configTerminalsOpenBesideTheSetupTerminal() async {
    let backend = RecordingBackend()
    backend.reply("read_argus_config", #"{"setup":{"copy":[],"symlink":[],"commands":[]},"terminals":[{"name":"Logs","dir":""}],"workspace_env":[],"run":[],"browser_presets":[],"protected_branches":[],"release_note_patterns":[],"simulator_deeplinks":[]}"#)
    backend.reply("list_terminals", #"[{"id":"setup","sessionId":"s1","title":"Setup","runTitle":null,"exited":false,"exitCode":null}]"#)
    backend.reply("create_terminal", #""t1""#)
    let store = makeStore(backend)
    await store.open(sessionId: "s1", repoRoot: "/repo")
    #expect(store.tabs("s1").map(\.title) == ["Setup", "Logs"])
    #expect(store.active("s1")?.id == "t1")
  }

  @Test func writesReachTheHostInTheOrderTheyWereTyped() async {
    let backend = RecordingBackend()
    let store = makeStore(backend)
    let chunks = ["\u{1b}[200~", "echo pasted"] + (0..<40).map { "\($0)" } + ["\u{1b}[201~"]
    for chunk in chunks { store.write("t1", Data(chunk.utf8)) }
    #expect(await eventually { backend.calls("terminal_write").count == chunks.count })
    let sent = backend.calls("terminal_write").compactMap { call -> String? in
      guard case .object(let params) = call.params, let data = params["data"]?.stringValue,
        let bytes = Data(base64Encoded: data)
      else { return nil }
      return String(decoding: bytes, as: UTF8.self)
    }
    #expect(sent == chunks)
  }
}
