package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.PillTab
import dev.houwert.argus.ui.components.PillTabBar
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.ColorTheme
import dev.houwert.argus.ui.theme.argusFont

/** The gallery's pages, one per family of components. */
enum class GalleryPage(val title: String) {
  Tokens("Tokens"),
  Buttons("Buttons"),
  Status("Status"),
  Lists("Lists"),
  Settings("Settings"),
  Chrome("Chrome"),
  Icons("Icons"),
}

/**
 * Every component in the design system, page by page, in either scheme and any colour theme:
 * the Android twin of the iOS gallery stories. Debug only; `GalleryActivity` hosts it.
 */
@Composable
fun ArgusGallery(initialDark: Boolean = false, initialPage: GalleryPage = GalleryPage.Tokens) {
  var dark by rememberSaveable { mutableStateOf(initialDark) }
  var colorTheme by rememberSaveable { mutableStateOf(ColorTheme.Default) }
  var page by rememberSaveable { mutableStateOf(initialPage) }
  ArgusTheme(dark = dark, colorTheme = colorTheme) {
    val theme = ArgusTheme.colors
    Column(Modifier.fillMaxSize().background(theme.bg).statusBarsPadding()) {
      Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text("Design system", Modifier.weight(1f), color = theme.text, style = argusFont(22, FontWeight.Bold))
        MenuChip(
          "Scheme", dark, listOf(PickerOption(false, "Light"), PickerOption(true, "Dark")), { dark = it },
          icon = if (dark) dev.houwert.argus.ui.icons.SfSymbol["circle.lefthalf.filled"] else Icon.unsnooze,
        )
        MenuChip("Theme", colorTheme, ColorTheme.entries.map { PickerOption(it, it.label) }, { colorTheme = it })
      }
      Box(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
        PillTabBar(
          GalleryPage.entries.map { PillTab(it, it.title, pageIcon(it)) }, page, { page = it }, compact = true,
        )
      }
      Box(Modifier.weight(1f)) {
        when (page) {
          GalleryPage.Icons -> IconsPage()
          else ->
            Column(
              Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
              verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
              when (page) {
                GalleryPage.Tokens -> TokensPage()
                GalleryPage.Buttons -> ButtonsPage()
                GalleryPage.Status -> StatusPage()
                GalleryPage.Lists -> ListsPage()
                GalleryPage.Settings -> SettingsGalleryPage()
                GalleryPage.Chrome -> ChromePage()
                GalleryPage.Icons -> Unit
              }
            }
        }
      }
    }
  }
}

private fun pageIcon(page: GalleryPage) =
  when (page) {
    GalleryPage.Tokens -> Icon.design
    GalleryPage.Buttons -> Icon.play
    GalleryPage.Status -> Icon.details
    GalleryPage.Lists -> Icon.menu
    GalleryPage.Settings -> Icon.gear
    GalleryPage.Chrome -> Icon.sidePanel
    GalleryPage.Icons -> Icon.image
  }

/** A titled block of the gallery. */
@Composable
internal fun Story(title: String, content: @Composable ColumnScope.() -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    SectionHeader(title)
    content()
  }
}

@Preview(name = "Gallery, light", widthDp = 400, heightDp = 900)
@Composable
private fun GalleryLightPreview() = ArgusGallery(initialDark = false)

@Preview(name = "Gallery, dark", widthDp = 400, heightDp = 900)
@Composable
private fun GalleryDarkPreview() = ArgusGallery(initialDark = true)
