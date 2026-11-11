import Testing

@testable import ArgusCore

@Suite("MessageCommand")
struct MessageCommandTests {
  private func command(_ argument: String?, kind: RemoteMessageCommand.Kind = .argus) -> RemoteMessageCommand {
    RemoteMessageCommand(name: "implement-ticket", kind: kind, argument: argument, notes: "keep it", prompt: "# Go")
  }

  @Test("names the issue from an identifier or a Linear URL")
  func issue() {
    #expect(command("ENG-273").issueIdentifier == "ENG-273")
    #expect(command("https://linear.app/acme/issue/eng-12/fix-tabs").issueIdentifier == "ENG-12")
    #expect(command("https://linear.app/acme/issue/eng-12/fix-tabs").argumentLabel == "ENG-12")
    #expect(command("whatever").issueIdentifier == nil)
    #expect(command("https://example.com/x").argumentURL?.host() == "example.com")
    #expect(command("ENG-1").argumentURL == nil)
  }

  @Test("only an Argus command has a playbook")
  func playbook() {
    #expect(command("ENG-1").playbook == "# Go")
    #expect(command("ENG-1", kind: .runner).playbook == nil)
    #expect(command(nil).label == "/implement-ticket")
  }

  @Test("the bubble shows the notes, not the typed command")
  func body() {
    var message = RemoteMessage(id: "m", role: .user, textBlocks: ["/implement-ticket ENG-1 keep it"])
    #expect(message.bodyBlocks == ["/implement-ticket ENG-1 keep it"])
    message.command = command("ENG-1")
    #expect(message.bodyBlocks == ["keep it"])
    #expect(message.copyText == "/implement-ticket ENG-1 keep it")
  }
}
