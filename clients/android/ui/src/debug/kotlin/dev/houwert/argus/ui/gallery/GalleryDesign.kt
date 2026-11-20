package dev.houwert.argus.ui.gallery

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.DesignCompareTarget
import dev.houwert.argus.core.stores.DesignViewerModel
import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.protocol.generated.DesignComparison
import dev.houwert.argus.kit.protocol.generated.DesignRef
import dev.houwert.argus.kit.protocol.generated.FigmaFrame
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetails
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetailsCommentsItem
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetailsFile
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetailsPagesItem
import dev.houwert.argus.kit.protocol.generated.FigmaFrameDetailsPagesItemFramesItem
import dev.houwert.argus.kit.protocol.generated.FigmaLayer
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import dev.houwert.argus.ui.design.DesignComparisonView
import dev.houwert.argus.ui.design.DesignViewerView
import java.io.ByteArrayOutputStream

private const val LOGIN = "https://www.figma.com/design/k/App?node-id=1-2"

/** The fixture frame's layers: x, y, width, height in frame points, and the render's fill. */
private class FixtureLayer(val id: String, val name: String, val type: String, val depth: Int, val x: Int, val y: Int, val w: Int, val h: Int, val argb: Long, val text: String? = null)

private val boxes = listOf(
  FixtureLayer("1:2", "Login", "FRAME", 0, 0, 0, 390, 844, 0xFFF6F6F9),
  FixtureLayer("1:3", "Header", "FRAME", 1, 0, 0, 390, 120, 0xFF5E6AD2),
  FixtureLayer("1:4", "Title", "TEXT", 2, 24, 64, 220, 32, 0xFFFFFFFF, "Welcome back"),
  FixtureLayer("1:5", "Form", "FRAME", 1, 24, 168, 342, 260, 0xFFFFFFFF),
  FixtureLayer("1:6", "Email field", "INSTANCE", 2, 40, 196, 310, 48, 0xFFE9E9EF),
  FixtureLayer("1:7", "Password field", "INSTANCE", 2, 40, 260, 310, 48, 0xFFE9E9EF),
  FixtureLayer("1:8", "Sign in", "COMPONENT", 2, 40, 340, 310, 52, 0xFF5E6AD2),
  FixtureLayer("1:9", "Label", "TEXT", 3, 160, 354, 70, 24, 0xFFFFFFFF, "Sign in"),
  FixtureLayer("1:10", "Illustration", "GROUP", 1, 95, 500, 200, 200, 0xFFF2C94C),
  FixtureLayer("1:11", "Sun", "ELLIPSE", 2, 145, 550, 100, 100, 0xFFF2994A),
  FixtureLayer("1:12", "Footer", "TEXT", 1, 24, 780, 342, 20, 0xFF8A8F98, "Forgot your password?"),
)

private fun framePng(): String {
  val bitmap = Bitmap.createBitmap(390, 844, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  for (box in boxes) {
    paint.color = box.argb.toInt()
    if (box.type == "ELLIPSE") canvas.drawOval(box.x.toFloat(), box.y.toFloat(), (box.x + box.w).toFloat(), (box.y + box.h).toFloat(), paint)
    else canvas.drawRoundRect(box.x.toFloat(), box.y.toFloat(), (box.x + box.w).toFloat(), (box.y + box.h).toFloat(), 8f, 8f, paint)
  }
  val out = ByteArrayOutputStream()
  bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
  return ArgusBase64.encode(out.toByteArray())
}

private fun frameDetails(png: String) = FigmaFrameDetails(
  ref = DesignRef(LOGIN, "k", "1:2", "Login", "8"),
  frame = FigmaFrame("Login", png, 390.0, 844.0),
  layers = boxes.map {
    FigmaLayer(
      it.id, it.name, it.type, it.depth.toDouble(), it.x.toDouble(), it.y.toDouble(), it.w.toDouble(), it.h.toDouble(),
      text = it.text, fill = "#%06x".format(it.argb and 0xFFFFFF), font = if (it.type == "TEXT") "Inter 600 16/24" else null,
    )
  },
  comments = listOf(
    FigmaFrameDetailsCommentsItem("Grace Hopper", "The button should be full width on small phones."),
    FigmaFrameDetailsCommentsItem("Ada Lovelace", "Swapped the illustration for the new one."),
  ),
  file = FigmaFrameDetailsFile("Argus app", "9", System.currentTimeMillis() - 2 * 86_400_000.0),
  pages = listOf(
    FigmaFrameDetailsPagesItem(
      "Onboarding",
      listOf(
        FigmaFrameDetailsPagesItemFramesItem("Login", LOGIN),
        FigmaFrameDetailsPagesItemFramesItem("Sign up", "https://www.figma.com/design/k/App?node-id=3-4"),
        FigmaFrameDetailsPagesItemFramesItem("Pair a computer", "https://www.figma.com/design/k/App?node-id=5-6"),
      ),
    ),
    FigmaFrameDetailsPagesItem("Archive", emptyList()),
  ),
)

@Composable
internal fun DesignGalleryStories() {
  val png = remember { framePng() }
  Story("Design viewer") {
    val host = rememberGalleryHost(reply(Methods.FigmaFrameDetails, MethodsTypes.FigmaFrameDetailsResult(frameDetails(png))))
    // Session version 8 against the file's 9: the "design changed" banner shows.
    val model = remember { DesignViewerModel(LOGIN, sessionVersion = "8", host = host) }
    Box(Modifier.fillMaxWidth().height(1100.dp)) {
      DesignViewerView(
        model,
        compareTargets = listOf(
          DesignCompareTarget(RemotePlatform.ios, "A1", "iPhone 17 Pro"),
          DesignCompareTarget(RemotePlatform.android, "emulator-5554", "Pixel 9"),
        ),
      )
    }
  }
  Story("Design compare") {
    DesignComparisonView(
      DesignComparison(0.126, 390.0, 844.0, png, png, png), percent = 13, deviceName = "Pixel 9", onClose = {},
    )
  }
}
