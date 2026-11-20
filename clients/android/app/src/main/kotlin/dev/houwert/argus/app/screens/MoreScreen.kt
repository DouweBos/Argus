package dev.houwert.argus.app.screens

import androidx.compose.runtime.Composable
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.AppSection
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsLinkRow
import dev.houwert.argus.ui.components.SettingsPage

/** The phone's fifth tab: every section without a tab of its own, in the Mac sidebar's order. */
@Composable
fun MoreScreen() {
  AppScreen("More") {
    SettingsPage {
      SettingsGroup {
        Row(AppSection.PullRequests)
        Row(AppSection.Blueprints)
        Row(AppSection.Issues)
        Row(AppSection.Devices)
      }
      SettingsGroup {
        Row(AppSection.Usage)
        Row(AppSection.Notifications)
      }
      SettingsGroup { Row(AppSection.Settings) }
    }
  }
}

@Composable
private fun Row(section: AppSection) {
  val router = LocalRouter.current
  SettingsLinkRow(section.title, icon = section.icon) { router.push(section.root) }
}
