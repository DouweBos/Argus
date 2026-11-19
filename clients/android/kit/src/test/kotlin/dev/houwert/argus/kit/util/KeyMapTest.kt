package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class KeyMapTest {
  @Test fun iosTakesTheMacKeycodeAndModifierFlagsAsTheyAre() {
    val key = KeyMap.nativeKey(
      RemotePlatform.ios, macKeyCode = 4,
      modifierFlags = KeyMap.MacModifier.COMMAND or KeyMap.MacModifier.SHIFT or 0x100,
    )
    assertEquals(KeyMap.NativeKey(4, 0x120000), key)
  }

  @Test fun androidMapsThroughThePhysicalKeyAndBuildsAMetaState() {
    // kVK_ANSI_A with shift and option.
    val key = KeyMap.nativeKey(
      RemotePlatform.android, macKeyCode = 0,
      modifierFlags = KeyMap.MacModifier.SHIFT or KeyMap.MacModifier.OPTION,
    )
    assertEquals(KeyMap.NativeKey(29, 0x3), key)
    assertEquals(19, KeyMap.nativeKey(RemotePlatform.android, macKeyCode = 126, modifierFlags = 0)?.keyCode)
    assertEquals(131, KeyMap.nativeKey(RemotePlatform.android, macKeyCode = 122, modifierFlags = 0)?.keyCode)
  }

  @Test fun keysWithoutADeviceEquivalentAreDropped() {
    assertEquals("KeyH", KeyMap.code(4))
    // kVK_JIS_Eisu.
    assertNull(KeyMap.nativeKey(RemotePlatform.ios, macKeyCode = 102, modifierFlags = 0))
  }

  @Test fun browserKeysAreDomKeyNamesOrTheTypedCharacter() {
    assertEquals("Enter", KeyMap.domKey(36, "\r"))
    assertEquals("Shift", KeyMap.domKey(56, null))
    assertEquals("A", KeyMap.domKey(0, "A"))
    assertNull(KeyMap.domKey(102, ""))
  }

  @Test fun typedCharactersMapToKeyPresses() {
    assertEquals(KeyMap.NativeKey(29, 0), KeyMap.nativeKey(RemotePlatform.android, "a"))
    assertEquals(KeyMap.NativeKey(0, 0x20000), KeyMap.nativeKey(RemotePlatform.ios, "A"))
    assertEquals(KeyMap.NativeKey(19, 0x20000), KeyMap.nativeKey(RemotePlatform.ios, "@"))
    assertEquals(KeyMap.NativeKey(67, 0), KeyMap.nativeKey(RemotePlatform.android, "Backspace"))
    assertNull(KeyMap.nativeKey(RemotePlatform.ios, "é"))
  }
}
