import Testing

@testable import ArgusKit

@Suite("KeyMap from Mac key events")
struct KeyMapTests {
  @Test("iOS takes the Mac keycode and modifier flags as they are")
  func ios() {
    let key = KeyMap.nativeKey(
      platform: .ios, macKeyCode: 4,
      modifierFlags: KeyMap.MacModifier.command | KeyMap.MacModifier.shift | 0x100)
    #expect(key == .init(keyCode: 4, modifiers: 0x120000))
  }

  @Test("Android maps through the physical key and builds a meta state")
  func android() {
    // kVK_ANSI_A with shift and option.
    let key = KeyMap.nativeKey(
      platform: .android, macKeyCode: 0,
      modifierFlags: KeyMap.MacModifier.shift | KeyMap.MacModifier.option)
    #expect(key == .init(keyCode: 29, modifiers: 0x3))
    #expect(KeyMap.nativeKey(platform: .android, macKeyCode: 126, modifierFlags: 0)?.keyCode == 19)
    #expect(KeyMap.nativeKey(platform: .android, macKeyCode: 122, modifierFlags: 0)?.keyCode == 131)
  }

  @Test("keys without a device equivalent are dropped")
  func unknown() {
    #expect(KeyMap.code(macKeyCode: 4) == "KeyH")
    // kVK_JIS_Eisu.
    #expect(KeyMap.nativeKey(platform: .ios, macKeyCode: 102, modifierFlags: 0) == nil)
  }
}
