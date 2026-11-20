package dev.houwert.argus.ui.integrations

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ManageSearch
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.ChangeHistory
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.CropSquare
import androidx.compose.material.icons.outlined.DataUsage
import androidx.compose.material.icons.outlined.Diamond
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.FilterNone
import androidx.compose.material.icons.outlined.Gesture
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PersonAddAlt
import androidx.compose.material.icons.outlined.SubdirectoryArrowLeft
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material.icons.outlined.Update
import androidx.compose.material.icons.outlined.ViewInAr
import androidx.compose.ui.graphics.vector.ImageVector
import dev.houwert.argus.core.stores.IssueFilter
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEventKind
import dev.houwert.argus.ui.icons.Icon

/** The Linear and Figma screens' glyphs, after the iPhone app's SF Symbols. */
object IntegrationIcon {
  val estimate: ImageVector = Icons.Outlined.ChangeHistory
  val cycle: ImageVector = Icons.Outlined.Autorenew
  val project: ImageVector = Icons.Outlined.ViewInAr
  val label: ImageVector = Icons.Outlined.LocalOffer
  val due: ImageVector = Icons.Outlined.CalendarToday
  val team: ImageVector = Icons.Outlined.Layers
  val status: ImageVector = Icons.Outlined.DataUsage
  val priority: ImageVector = Icons.Outlined.BarChart
  val number: ImageVector = Icons.Outlined.Tag
  val parent: ImageVector = Icons.Outlined.SubdirectoryArrowLeft
  val unfold: ImageVector = Icons.Outlined.UnfoldMore
  val created: ImageVector = Icons.Outlined.AddCircleOutline
  val relation: ImageVector = Icons.Outlined.FilterNone
  val video: ImageVector = Icons.Outlined.Movie
  val other: ImageVector = Icons.Outlined.Circle

  /** A history line's icon, by what changed. */
  fun history(kind: LinearHistoryEventKind): ImageVector = when (kind) {
    LinearHistoryEventKind.status -> status
    LinearHistoryEventKind.priority -> priority
    LinearHistoryEventKind.assignee -> Icon.person
    LinearHistoryEventKind.estimate -> estimate
    LinearHistoryEventKind.cycle -> cycle
    LinearHistoryEventKind.project -> project
    LinearHistoryEventKind.labels -> label
    LinearHistoryEventKind.title, LinearHistoryEventKind.description -> Icon.pencil
    LinearHistoryEventKind.due -> due
    LinearHistoryEventKind.parent -> parent
    LinearHistoryEventKind.relation -> relation
    LinearHistoryEventKind.attachment -> Icon.link
    LinearHistoryEventKind.created -> created
    else -> other
  }

  /** The field's icon in the filter menu, after Linear's. */
  fun field(field: IssueFilter.Field): ImageVector = when (field) {
    IssueFilter.Field.Team -> Icons.Outlined.Groups
    IssueFilter.Field.Status -> status
    IssueFilter.Field.StatusType -> Icons.Outlined.Contrast
    IssueFilter.Field.Assignee -> Icon.person
    IssueFilter.Field.Creator -> Icons.Outlined.PersonAddAlt
    IssueFilter.Field.Priority -> priority
    IssueFilter.Field.Estimate -> estimate
    IssueFilter.Field.Labels -> label
    IssueFilter.Field.Relations -> Icons.Outlined.AccountTree
    IssueFilter.Field.Due -> due
    IssueFilter.Field.Created -> Icons.Outlined.EditCalendar
    IssueFilter.Field.Updated -> Icons.Outlined.Update
    IssueFilter.Field.Project -> project
    IssueFilter.Field.Cycle -> cycle
    IssueFilter.Field.Links -> Icon.link
    IssueFilter.Field.Content -> Icons.AutoMirrored.Outlined.ManageSearch
  }

  /** A Figma layer's icon, by its node type. */
  fun layer(type: String): ImageVector = when (type) {
    "TEXT" -> Icons.Outlined.TextFields
    "FRAME", "SECTION" -> number
    "GROUP" -> relation
    "COMPONENT", "COMPONENT_SET", "INSTANCE" -> Icons.Outlined.Diamond
    "ELLIPSE" -> other
    "VECTOR", "LINE", "STAR", "POLYGON", "BOOLEAN_OPERATION" -> Icons.Outlined.Gesture
    else -> Icons.Outlined.CropSquare
  }
}
