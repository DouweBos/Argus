package dev.houwert.argus.ui

import dev.houwert.argus.ui.images.RemoteImages
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteImagesTest {
  @Test fun onlyHttpsPicturesAreFetched() {
    assertTrue(RemoteImages.loadable("https://public.linear.app/avatars/ada.png"))
    assertTrue(RemoteImages.loadable("HTTPS://img.example.com/u/1"))
    assertFalse(RemoteImages.loadable(null))
    assertFalse(RemoteImages.loadable(" "))
    assertFalse(RemoteImages.loadable("http://img.example.com/u/1"))
    assertFalse(RemoteImages.loadable("file:///data/data/x.png"))
    assertFalse(RemoteImages.loadable("https:///nohost"))
    assertFalse(RemoteImages.loadable("not a url"))
  }
}
