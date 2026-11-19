package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals

class CronLabelTest {
  @Test fun commonShapesReadAsWords() {
    val cases = listOf(
      "*/15 * * * *" to "every 15 minutes",
      "30 * * * *" to "hourly at :30",
      "0 */6 * * *" to "every 6 hours",
      "0 9 * * *" to "09:00 daily",
      "0 9 * * 1-5" to "09:00 weekdays",
      "0 10 * * 0,6" to "10:00 weekends",
      "0 9 * * 1" to "09:00 Mondays",
      "0 9 * * 7" to "09:00 Sundays",
      "30 8 * * 1,3,5" to "08:30 Mon, Wed, Fri",
      "0 9 1 * *" to "09:00 monthly on the 1st",
      "0 9 22 * *" to "09:00 monthly on the 22nd",
      "0 9 13 * *" to "09:00 monthly on the 13th",
    )
    for ((cron, expected) in cases) assertEquals(expected, Labels.cronLabel(cron, null), cron)
  }

  @Test fun anythingFancierStaysTheCron() {
    for (cron in listOf("0 9 1 * 1", "0 9 * 6 *", "5 */6 * * *", "0 9 * * MON", "0 9-17 * * *", "0 9 * * 8", "bogus")) {
      assertEquals(cron, Labels.cronLabel(cron, null))
    }
  }
}
