import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
struct ClaudeLoginTests {
  @Test func aLocalSignInKeepsTheURLWithoutRaisingANotice() async throws {
    let backend = RecordingBackend(kind: .local)
    backend.reply("claude_accounts.login_start", #"{"url":"https://claude.ai/x"}"#)
    let store = HostStore()
    await store.attach(backend)

    #expect(await store.startClaudeLogin(accountId: "a1", useConsole: true))
    #expect(store.claudeLogin?.pending == true)
    #expect(store.claudeLoginURL == "https://claude.ai/x")
    #expect(store.lastError == nil)
    let params = backend.calls("claude_accounts.login_start").first?.params
    #expect(params.flatMap { if case .object(let fields) = $0 { fields["use_console"] } else { nil } } == .bool(true))

    try backend.emit("claude_accounts.login", payload: #"{"pending":false,"needs_code":false,"ok":true}"#)
    #expect(await eventually { store.claudeLogin?.pending == false })
    #expect(store.claudeLoginURL == nil)
  }

  @Test func theGatewaySurfacesTheURLToOpenOnTheComputer() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("claude_accounts.add", #"{"url":"https://claude.ai/y"}"#)
    let store = HostStore()
    await store.attach(backend)

    #expect(await store.addClaudeAccount(useConsole: false))
    #expect(store.lastError?.contains("https://claude.ai/y") == true)
  }
}
