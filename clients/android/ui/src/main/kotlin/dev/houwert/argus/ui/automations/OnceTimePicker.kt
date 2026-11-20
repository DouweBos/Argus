package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import android.text.format.DateFormat
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The run-once trigger's wall clock, `YYYY-MM-DDTHH:mm`, read and written as such: no zone conversion. */
object OnceWallClock {
  fun parse(runAt: String?): LocalDateTime? =
    runAt?.let { runCatching { LocalDateTime.parse(it, DateTimeFormatter.ISO_LOCAL_DATE_TIME) }.getOrNull() }

  fun format(value: LocalDateTime): String =
    String.format(Locale.ROOT, "%04d-%02d-%02dT%02d:%02d", value.year, value.monthValue, value.dayOfMonth, value.hour, value.minute)
}

/**
 * Date and time chips that open the system pickers. The picked wall-clock time is kept in the
 * trigger's own zone, so "9:00" means 9:00 wherever the computer is set to run it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnceTimePicker(runAt: String?, onChange: (String) -> Unit) {
  val theme = ArgusTheme.colors
  val current = OnceWallClock.parse(runAt) ?: LocalDateTime.now().withSecond(0).withNano(0)
  var pickingDate by rememberSaveable { mutableStateOf(false) }
  var pickingTime by rememberSaveable { mutableStateOf(false) }
  val locale = Locale.getDefault()
  val dateLabel = current.toLocalDate().format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
  val timeLabel = current.toLocalTime().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))

  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    Text("Run at", Modifier.weight(1f), color = theme.text, style = argusFont(15))
    Chip(dateLabel, icon = Icon.clock, contentDescription = "Date: $dateLabel") { pickingDate = true }
    Chip(timeLabel, contentDescription = "Time: $timeLabel") { pickingTime = true }
  }

  if (pickingDate) {
    // The picker speaks UTC midnights; only the calendar date is taken from it.
    val state = rememberDatePickerState(initialSelectedDateMillis = current.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    DatePickerDialog(
      onDismissRequest = { pickingDate = false },
      confirmButton = {
        TextButton({
          state.selectedDateMillis?.let { millis ->
            val date = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()
            onChange(OnceWallClock.format(LocalDateTime.of(date, current.toLocalTime())))
          }
          pickingDate = false
        }) { Text("Done") }
      },
      dismissButton = { TextButton({ pickingDate = false }) { Text("Cancel") } },
    ) { DatePicker(state) }
  }

  if (pickingTime) {
    val state = rememberTimePickerState(current.hour, current.minute, is24Hour = DateFormat.is24HourFormat(LocalContext.current))
    AlertDialog(
      onDismissRequest = { pickingTime = false },
      confirmButton = {
        TextButton({
          onChange(OnceWallClock.format(LocalDateTime.of(current.toLocalDate(), LocalTime.of(state.hour, state.minute))))
          pickingTime = false
        }) { Text("Done") }
      },
      dismissButton = { TextButton({ pickingTime = false }) { Text("Cancel") } },
      text = { TimePicker(state) },
      containerColor = theme.surface,
    )
  }
}
