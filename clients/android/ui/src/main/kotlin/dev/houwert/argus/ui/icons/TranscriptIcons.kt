package dev.houwert.argus.ui.icons

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.ui.graphics.vector.ImageVector

// The transcript's own glyphs, kept apart from ArgusIcons.kt so parallel ports don't collide there.

/** A multi-select option: `square` / `checkmark.square.fill`. */
val Icon.checkboxOff: ImageVector get() = Icons.Outlined.CheckBoxOutlineBlank
val Icon.checkboxOn: ImageVector get() = Icons.Filled.CheckBox

/** A single-select option: `circle` / `largecircle.fill.circle`. */
val Icon.radioOff: ImageVector get() = Icons.Outlined.RadioButtonUnchecked
val Icon.radioOn: ImageVector get() = Icons.Filled.RadioButtonChecked

val Icon.film: ImageVector get() = Icons.Outlined.Movie
