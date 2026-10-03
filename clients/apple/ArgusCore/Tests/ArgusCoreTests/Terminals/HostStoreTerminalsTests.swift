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
