package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.generated.FigmaLayer
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

class DesignViewerModelTest {
  private val login = "https://www.figma.com/design/k/App?node-id=1-2"
  private val signup = "https://www.figma.com/design/k/?node-id=3-4"

  private fun details(node: String, name: String, version: String) =
    """{"details":{"ref":{"url":"u","fileKey":"k","nodeId":"$node","name":"$name","version":"$version"},
     "frame":{"name":"$name","image":"aGk=","width":390,"height":844},
     "layers":[{"id":"1:3","name":"Title","type":"TEXT","depth":1,"x":0,"y":0,"width":200,"height":24,
       "text":"Welcome","fill":"#111111","font":"Inter 600 16/24"}],
     "comments":[{"author":"Ann","body":"Bigger"}],
     "file":{"name":"App","version":"$version","lastModified":1700000000000},
     "pages":[{"name":"Screens","frames":[{"name":"Login","url":"$login"},{"name":"Sign up","url":"$signup"}]}]}}"""

  private fun TestScope.model(sessionVersion: String? = null): Pair<DesignViewerModel, FakeBackend> {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.FigmaFrameDetails, details("1:2", "Login", "8"))
    return DesignViewerModel(login, sessionVersion, store) to backend
  }

  @Test fun loadsTheFrameAndDecodesItsImage() = runTest {
    val (model, _) = model()
    model.load()

    assertEquals("Welcome", model.details.value?.layers?.first()?.text)
    assertContentEquals("hi".toByteArray(), model.image.value)
    assertTrue(model.isCurrent(login))
    assertFalse(model.isCurrent(signup))
    assertFalse(model.designChanged)
  }

  @Test fun tellsWhenTheDesignMovedOnSinceTheSessionCapturedIt() = runTest {
    val (model, _) = model(sessionVersion = "7")
    model.load()
    assertTrue(model.designChanged)

    val (same, _) = model(sessionVersion = "8")
    same.load()
    assertFalse(same.designChanged)
  }

  @Test fun movesToAnotherFrameAndBack() = runTest {
    val (model, backend) = model()
    model.load()
    backend.reply(Methods.FigmaFrameDetails, details("3:4", "Sign up", "8"))

    model.open(signup)
    assertEquals("Sign up", model.details.value?.frame?.name)
    assertEquals(listOf(login), model.history.value)

    backend.reply(Methods.FigmaFrameDetails, details("1:2", "Login", "8"))
    model.back()
    assertEquals(login, model.url.value)
    assertTrue(model.history.value.isEmpty())
  }

  @Test fun saysSoWhenTheLinkIsntAFrame() = runTest {
    val (model, backend) = model()
    backend.reply(Methods.FigmaFrameDetails, """{"details":null}""")
    model.load()

    assertNull(model.details.value)
    assertNotNull(model.loadError.value)
  }

  @Test fun comparesAgainstThePickedDevice() = runTest {
    val (model, backend) = model()
    backend.reply(
      Methods.DesignCompare,
      """{"comparison":{"differingFraction":0.126,"width":2,"height":2,"design":"aGk=","screenshot":"aGk=","diff":"aGk="}}""",
    )
    val target = DesignCompareTarget(RemotePlatform.ios, "UDID", "iPhone")

    model.compare(target)

    assertEquals(13, model.differingPercent)
    assertEquals("""{"url":"$login","platform":"ios","device_key":"UDID"}""", backend.params(Methods.DesignCompare).toString())

    backend.fail(Methods.DesignCompare)
    model.compare(target)
    assertNotNull(model.compareError.value)
  }

  @Test fun selectsTheLayerUnderATapAndClearsOnANewFrame() = runTest {
    val (model, backend) = model()
    model.load()
    val sources = mutableListOf<DesignViewerModel.SelectionSource>()
    model.onFirstSelection = { sources += it }

    model.select(FramePoint(5.0, 5.0))
    assertEquals("Title", model.selectedLayer?.name)
    model.select(FramePoint(500.0, 5.0))
    assertNull(model.selectedLayerId.value)
    model.select("1:3", DesignViewerModel.SelectionSource.Tree)
    assertEquals(listOf(DesignViewerModel.SelectionSource.Canvas), sources)

    backend.reply(Methods.FigmaFrameDetails, details("3:4", "Sign up", "8"))
    model.open(signup)
    assertNull(model.selectedLayerId.value)
  }

  @Test fun readsTheFlattenedLayersBackAsATree() {
    fun layer(id: String, depth: Double, rect: FrameRect? = null) =
      FigmaLayer(id, id, "FRAME", depth, x = rect?.x, y = rect?.y, width = rect?.width, height = rect?.height)
    val tree = DesignLayerTree(
      listOf(
        layer("root", 0.0, FrameRect(0.0, 0.0, 100.0, 100.0)),
        layer("card", 1.0, FrameRect(10.0, 10.0, 50.0, 50.0)),
        layer("icon", 2.0, FrameRect(20.0, 20.0, 10.0, 10.0)),
        layer("label", 1.0, FrameRect(40.0, 40.0, 40.0, 10.0)),
        layer("ghost", 1.0),
      )
    )

    assertEquals(listOf("card", "root"), tree.ancestors("icon"))
    assertTrue(tree.hasChildren("card"))
    assertFalse(tree.hasChildren("label"))
    assertEquals(listOf("root", "card", "label", "ghost"), tree.visible(setOf("card")).map { it.id })
    assertEquals("icon", tree.hit(FramePoint(25.0, 25.0))?.id)
    assertEquals("label", tree.hit(FramePoint(45.0, 45.0))?.id)
    assertEquals("root", tree.hit(FramePoint(90.0, 90.0))?.id)
    assertNull(tree.hit(FramePoint(200.0, 0.0)))
  }

  @Test fun recognisesFigmaDesignLinks() {
    assertTrue(FigmaLink.isDesign("https://www.figma.com/design/k/App?node-id=1-2"))
    assertTrue(FigmaLink.isDesign("https://figma.com/file/k/App"))
    assertTrue(FigmaLink.isDesign("https://www.figma.com/proto/k/App"))
    assertFalse(FigmaLink.isDesign("https://www.figma.com/community/plugin/1"))
    assertFalse(FigmaLink.isDesign("https://notfigma.com/design/k"))
    assertFalse(FigmaLink.isDesign("https://linear.app/x/issue/ENG-1"))
  }
}
