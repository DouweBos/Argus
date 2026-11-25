package dev.houwert.argus.ui.composer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PastedTextTest {
  @Test fun `text copied with images is kept`() {
    assertEquals("look at this", PastedText.besideImages("look at this", emptyList()))
    assertEquals("shot.png\nwhy?", PastedText.besideImages("shot.png\nwhy?", listOf("shot.png")))
  }

  @Test fun `text that only names the images is dropped`() {
    assertNull(PastedText.besideImages(null, emptyList()))
    assertNull(PastedText.besideImages("  \n", emptyList()))
    assertNull(PastedText.besideImages("content://media/1", listOf("content://media/1")))
  }
}
