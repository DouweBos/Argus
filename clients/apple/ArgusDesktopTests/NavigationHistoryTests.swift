import AppKit
import Carbon.HIToolbox
import Testing

@testable import Argus

struct NavigationHistoryTests {
  private let home = DesktopLocation(route: .home)
  private let agents = DesktopLocation(route: .agents)
  private let devices = DesktopLocation(route: .devices)

  @Test("Back and forward retrace the steps, and a new step drops forward")
  func backAndForward() {
    var history = NavigationHistory()
    history.leave(home)
    history.leave(agents)
    #expect(history.goBack(from: devices) == agents)
    #expect(history.goBack(from: agents) == home)
    #expect(history.goBack(from: home) == nil)
    #expect(history.goForward(from: home) == agents)
    history.leave(agents)
    #expect(!history.canGoForward)
    #expect(history.back == [home, agents])
  }

  @Test("The same place never sits twice in a row, nor right behind where the window is")
  func collapsesDuplicates() {
    var history = NavigationHistory()
    history.leave(home)
    history.leave(home)
    #expect(history.back == [home])
    history.settle(at: home)
    #expect(history.back.isEmpty)
    history.leave(agents)
    history.leave(devices)
    // Back from Agents can't land on Agents.
    #expect(history.goBack(from: devices) == agents)
    #expect(history.goForward(from: agents) == devices)
  }

  @Test("History keeps the last 50 places, as Electron's tabs do")
  func capped() {
    var history = NavigationHistory()
    for index in 0..<60 {
      history.leave(DesktopLocation(route: .automation(id: "\(index)", runId: nil)))
    }
    #expect(history.back.count == NavigationHistory.limit)
    #expect(history.back.first == DesktopLocation(route: .automation(id: "10", runId: nil)))
  }

  @Test("Side buttons 3 and 4 go back and forward; ⌃- and ⌃⇧- only in the code view")
  func inputs() throws {
    let back = try #require(mouseUp(button: 3))
    #expect(HistoryInput.action(for: back, codeView: false)?.direction == .back)
    #expect(HistoryInput.action(for: back, codeView: false)?.via == .mouse)
    let forward = try #require(mouseUp(button: 4))
    #expect(HistoryInput.action(for: forward, codeView: false)?.direction == .forward)
    let middle = try #require(mouseUp(button: 2))
    #expect(HistoryInput.action(for: middle, codeView: false) == nil)

    let minus = try #require(keyDown(flags: .control))
    #expect(HistoryInput.action(for: minus, codeView: true)?.direction == .back)
    #expect(HistoryInput.action(for: minus, codeView: false) == nil)
    let shifted = try #require(keyDown(flags: [.control, .shift]))
    #expect(HistoryInput.action(for: shifted, codeView: true)?.direction == .forward)
    let command = try #require(keyDown(flags: .command))
    #expect(HistoryInput.action(for: command, codeView: true) == nil)
  }

  private func mouseUp(button: Int) -> NSEvent? {
    guard
      let cg = NSEvent.mouseEvent(
        with: .otherMouseUp, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
        eventNumber: 0, clickCount: 1, pressure: 0)?.cgEvent
    else { return nil }
    cg.setIntegerValueField(.mouseEventButtonNumber, value: Int64(button))
    return NSEvent(cgEvent: cg)
  }

  private func keyDown(flags: NSEvent.ModifierFlags) -> NSEvent? {
    NSEvent.keyEvent(
      with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil,
      characters: "-", charactersIgnoringModifiers: "-", isARepeat: false, keyCode: UInt16(kVK_ANSI_Minus))
  }
}
