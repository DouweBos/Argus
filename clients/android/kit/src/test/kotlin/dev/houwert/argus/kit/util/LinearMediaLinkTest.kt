package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LinearMediaLinkTest {
  private val upload = "https://uploads.linear.app/abc/def/ghi"

  @Test fun aLinearImageOnItsOwnLineEmbeds() {
    assertEquals(
      LinearMediaLink(LinearMediaLink.Kind.IMAGE, upload, "shot.png"),
      LinearMediaLink.parse("![shot.png]($upload)"),
    )
  }

  @Test fun aLinkNamedLikeARecordingIsAVideoOtherLinksStayLinks() {
    assertEquals(LinearMediaLink.Kind.VIDEO, LinearMediaLink.parse("[Screen Recording.mov]($upload)")?.kind)
    assertEquals(LinearMediaLink.Kind.VIDEO, LinearMediaLink.parse("[clip]($upload/clip.MP4)")?.kind)
    assertNull(LinearMediaLink.parse("[notes.pdf]($upload)"))
  }

  @Test fun onlyUploadsOnLinearsHostFillingTheLine() {
    assertNull(LinearMediaLink.parse("![x.png](https://example.com/x.png)"))
    assertNull(LinearMediaLink.parse("see ![x.png]($upload)"))
  }

  @Test fun aParagraphSplitsAroundItsUploads() {
    assertEquals(
      listOf(
        LinearMediaLink.Segment.Text("Before"),
        LinearMediaLink.Segment.Media(LinearMediaLink(LinearMediaLink.Kind.IMAGE, upload, "a.png")),
        LinearMediaLink.Segment.Text("after one\nafter two"),
      ),
      LinearMediaLink.segments("Before\n![a.png]($upload)\nafter one\nafter two"),
    )
    assertEquals(listOf(LinearMediaLink.Segment.Text("plain")), LinearMediaLink.segments("plain"))
  }
}
