package dev.houwert.argus.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * Third-party marks (Octicons, MIT; licence in `assets/Octicons-LICENSE.txt`), as templates
 * that take the surrounding tint. Inset on a 20-unit canvas so they sit at a Material glyph's size.
 */
object BrandIcons {
  /** GitHub's mark, for sign-in buttons. */
  val github: ImageVector by lazy {
    octicon(
      "GitHub",
      "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z",
    )
  }

  val pullRequest: ImageVector by lazy {
    octicon(
      "PullRequest",
      "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
    )
  }

  val pullRequestDraft: ImageVector by lazy {
    octicon(
      "PullRequestDraft",
      "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z",
    )
  }

  val pullRequestClosed: ImageVector by lazy {
    octicon(
      "PullRequestClosed",
      "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z",
    )
  }

  val merge: ImageVector by lazy {
    octicon(
      "Merge",
      "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z",
    )
  }

  private fun octicon(name: String, path: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, viewportWidth = 20f, viewportHeight = 20f)
      .addGroup(translationX = 2f, translationY = 2f)
      .addPath(addPathNodes(path), fill = SolidColor(Color.Black))
      .clearGroup()
      .build()
}

/** Glyphs Material Icons lacks, drawn on its 24-unit grid at its 2-unit stroke. */
object ArgusGlyphs {
  /** `pin.slash`: Material's outlined push pin with a slash through it. */
  val pinSlash: ImageVector by lazy {
    ImageVector.Builder("PinSlash", 24.dp, 24.dp, 24f, 24f)
      .addPath(
        addPathNodes(
          "M14,4v5c0,1.12 0.37,2.16 1,3H9c0.65,-0.86 1,-1.9 1,-3V4H14M17,2H7C6.45,2 6,2.45 6,3c0,0.55 0.45,1 1,1l1,0v5c0,1.66 -1.34,3 -3,3v2h5.97v7l1,1l1,-1v-7H19v-2c-1.66,0 -3,-1.34 -3,-3V4l1,0c0.55,0 1,-0.45 1,-1C18,2.45 17.55,2 17,2L17,2z"
        ),
        fill = SolidColor(Color.Black),
      )
      .addPath(
        addPathNodes("M3,3L21,21"),
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round,
      )
      .build()
  }

  /** `slash.circle`: a slash command. */
  val slashCircle: ImageVector by lazy {
    ImageVector.Builder("SlashCircle", 24.dp, 24.dp, 24f, 24f)
      .addPath(
        addPathNodes("M12,3a9,9 0 1,0 0.001,0z"),
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 2f,
      )
      .addPath(
        addPathNodes("M14.5,7L9.5,17"),
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round,
      )
      .build()
  }
}
