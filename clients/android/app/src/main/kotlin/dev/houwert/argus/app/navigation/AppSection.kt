package dev.houwert.argus.app.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.ui.graphics.vector.ImageVector
import dev.houwert.argus.ui.icons.Icon as ArgusIcon

/**
 * The top-level destinations, as the Mac's sidebar lists them. A phone has room
 * for five tabs, so the rest live under More.
 */
enum class AppSection(val title: String, val root: Route, val icon: ImageVector) {
  Home("Home", Route.Projects, Icons.Outlined.Home),
  Inbox("Inbox", Route.Inbox, Icons.Outlined.Inbox),
  Agents("Agents", Route.Agents, Icons.Outlined.SmartToy),
  Devices("Devices", Route.Devices, Icons.Outlined.PhoneAndroid),
  Automations("Automations", Route.Automations, Icons.Outlined.Schedule),
  Issues("Issues", Route.Issues, Icons.AutoMirrored.Outlined.List),
  PullRequests("Pull Requests", Route.PullRequests, Icons.Outlined.AccountTree),
  Blueprints("Blueprints", Route.Blueprints, Icons.Outlined.Dashboard),
  Skills("Skills", Route.Skills, ArgusIcon.skills),
  Usage("Usage", Route.Usage, Icons.Outlined.Speed),
  Notifications("Notifications", Route.Notifications, Icons.Outlined.Notifications),
  Settings("Settings", Route.Settings, Icons.Outlined.Settings),
  More("More", Route.More, Icons.Outlined.MoreHoriz);

  /** Where this section lives on a phone: its own tab, or More. */
  val tab: AppSection get() = if (this in tabs) this else More

  companion object {
    /** The phone's tab bar. */
    val tabs = listOf(Home, Inbox, Agents, Automations, More)
    /** What More lists, in order. */
    val underMore = listOf(PullRequests, Blueprints, Skills, Issues, Devices, Usage, Notifications, Settings)
  }
}
