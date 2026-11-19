package dev.houwert.argus.app.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.AppSection

/** The phone's fifth tab: every section without a tab of its own. */
@Composable
fun MoreScreen() {
  val router = LocalRouter.current
  LazyColumn {
    items(AppSection.underMore) { section ->
      ListItem(
        headlineContent = { Text(section.title) },
        leadingContent = { Icon(section.icon, contentDescription = null) },
        modifier = Modifier.clickable(onClickLabel = "Open ${section.title}") { router.push(section.root) },
      )
    }
  }
}
