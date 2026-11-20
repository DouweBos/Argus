package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusTheme
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

/**
 * A day, then a time: Material's date picker followed by its time picker, for a moment in the
 * future. [onPick] gets it in the device's zone; a time already past keeps the dialog open.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimePickerDialog(
  title: String,
  initial: ZonedDateTime,
  confirmLabel: String,
  onPick: (ZonedDateTime) -> Unit,
  onDismiss: () -> Unit,
  footnote: String? = null,
) {
  val zone = ZoneId.systemDefault()
  val today = LocalDate.now(zone)
  val dateState = rememberDatePickerState(
    initialSelectedDateMillis = initial.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
    selectableDates = object : SelectableDates {
      override fun isSelectableDate(utcTimeMillis: Long) =
        !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().isBefore(today)
    },
  )
  val timeState = rememberTimePickerState(initial.hour, initial.minute)
  var pickingTime by remember { mutableStateOf(false) }
  DatePickerDialog(
    onDismissRequest = onDismiss,
    confirmButton = {
      if (pickingTime) {
        TextButton({
          val day = Instant.ofEpochMilli(dateState.selectedDateMillis ?: return@TextButton).atZone(ZoneOffset.UTC).toLocalDate()
          val picked = day.atTime(LocalTime.of(timeState.hour, timeState.minute)).atZone(zone)
          if (!picked.isAfter(ZonedDateTime.now(zone))) return@TextButton
          onDismiss()
          onPick(picked)
        }) { Text(confirmLabel) }
      } else {
        TextButton({ pickingTime = true }, enabled = dateState.selectedDateMillis != null) { Text("Next") }
      }
    },
    dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
  ) {
    if (pickingTime) {
      Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(title, style = ArgusTheme.typography.headline, maxLines = 1, overflow = TextOverflow.Ellipsis)
        TimePicker(timeState)
        if (footnote != null) Text(footnote, style = ArgusTheme.typography.footnote, color = ArgusTheme.colors.textSecondary)
      }
    } else {
      DatePicker(dateState, title = { Text(title, Modifier.padding(start = 24.dp, top = 16.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) })
    }
  }
}
