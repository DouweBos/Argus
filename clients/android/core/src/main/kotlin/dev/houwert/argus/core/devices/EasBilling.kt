package dev.houwert.argus.core.devices

/** EAS Simulator devices (`eas:<hostId>:<slot>`) start a billed Expo session when booted. */
object EasBilling {
  const val START_TITLE = "Start an EAS Simulator session?"
  const val START_CONFIRM = "Start session (billed)"

  /** The EAS host behind a device id, or null for any other device. */
  fun hostId(deviceId: String): String? {
    val parts = deviceId.split(":")
    if (parts.size != 3 || parts[0] != "eas" || parts[1].isEmpty() || parts[2].toIntOrNull() == null) return null
    return parts[1]
  }

  fun isEas(deviceId: String) = deviceId.startsWith("eas:")

  fun isBillableStart(deviceId: String, running: Boolean) = !running && hostId(deviceId) != null

  fun startMessage(idleMinutes: Int?, maxSessionMinutes: Int?): String {
    val until = if (idleMinutes != null && maxSessionMinutes != null) {
      "until you end it, it sits idle for $idleMinutes min, or it reaches its $maxSessionMinutes min limit"
    } else {
      "until you end it, it sits idle, or it reaches its time limit"
    }
    return "It costs money: the session is billed to your Expo account $until. It can take a few minutes to start."
  }
}
