package dev.houwert.argus.ui

import dev.houwert.argus.kit.protocol.generated.FigmaLayer
import dev.houwert.argus.ui.design.DesignComparisonText
import dev.houwert.argus.ui.design.DesignLayersText
import dev.houwert.argus.ui.integrations.LinearAvatarText
import dev.houwert.argus.ui.integrations.linearColor
import dev.houwert.argus.ui.theme.Tone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IntegrationsLogicTest {
  @Test fun readsLinearsHexColours() {
    assertEquals(0xFFF2C94C.toInt(), linearColor("#f2c94c")!!.value.shr(32).toInt())
    assertNull(linearColor("not a colour"))
    assertNull(linearColor(null))
  }

  @Test fun initialsFromAName() {
    assertEquals("AL", LinearAvatarText.initials("Ada Lovelace"))
    assertEquals("G", LinearAvatarText.initials("grace"))
    assertEquals("", LinearAvatarText.initials(" "))
  }

  @Test fun layerSizesAndTypes() {
    assertEquals("200×24", DesignLayersText.size(FigmaLayer("1", "T", "TEXT", 1.0, 0.0, 0.0, 199.6, 24.0)))
    assertNull(DesignLayersText.size(FigmaLayer("1", "T", "TEXT", 1.0)))
    assertEquals("Boolean operation", DesignLayersText.typeName("BOOLEAN_OPERATION"))
  }

  @Test fun underTwoPercentReadsAsAMatch() {
    assertEquals(Tone.Success, DesignComparisonText.tone(1, notOnScreen = false))
    assertEquals(Tone.Warning, DesignComparisonText.tone(5, notOnScreen = false))
    assertEquals(Tone.Danger, DesignComparisonText.tone(13, notOnScreen = false))
    assertEquals(Tone.Warning, DesignComparisonText.tone(0, notOnScreen = true))
  }
}
