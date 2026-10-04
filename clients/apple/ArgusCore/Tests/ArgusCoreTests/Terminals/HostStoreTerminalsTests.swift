import ArgusCore
import Foundation
import Testing

@MainActor
struct HostStoreTerminalsTests {
  @Test func readsASessionsTerminalsOverTheGateway() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("terminals.list", #"{"terminals":[{"id":"t1","title":null,"run_title":"dev"}]}"#)
    backend.reply("terminals.read", #"{"output":"ready\n","running":true,"exit_code":null,"truncated":false}"#)
    let store = HostStore()
    await store.attach(backend)

    let terminals = await store.listTerminals(sessionId: "s1")
    #expect(terminals.map(\.runTitle) == ["dev"])
    #expect(backend.calls("terminals.list").first?.params == .object(["session_id": .string("s1")]))
    #expect(await store.readTerminal(id: "t1")?.output == "ready\n")
  }

  @Test func aGoneTerminalReadsAsNil() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.fail("terminals.read")
    let store = HostStore()
    await store.attach(backend)
    #expect(await store.readTerminal(id: "t1") == nil)
  }
}

@MainActor
struct HostStoreTerminalStreamTests {
  @Test func stitchesTheReplayOntoLaterEvents() async throws {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("terminals.scrollback", #"{"data":"aGk=","truncated":false,"exit_code":null}"#)
    let store = HostStore()
    await store.attach(backend)

    var outputs: [TerminalFeed.Output] = []
    let stop = await store.followTerminal(id: "t1") { outputs += $0 }
    #expect(stop != nil)
    #expect(backend.subscriptions.first?.0 == "terminal:t1")
    try backend.emit("terminal.data", payload: #"{"terminal_id":"t1","data":"IQ=="}"#)
    try backend.emit("terminal.exit", payload: #"{"terminal_id":"t1","exit_code":0}"#)
    #expect(await eventually { outputs.count == 4 })
    #expect(outputs == [.reset, .data(Data("hi".utf8)), .data(Data("!".utf8)), .exit(0)])
    stop?()
    #expect(await eventually { backend.subscriptions.last.map { $0 == ("terminal:t1", false) } == true })
  }

  @Test func anOlderHostFallsBackToPolling() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.fail("terminals.scrollback")
    let store = HostStore()
    await store.attach(backend)
    #expect(await store.followTerminal(id: "t1") { _ in } == nil)
  }
}
