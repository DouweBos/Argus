package dev.houwert.argus.app

/** Release builds pair with exactly the code they were given; the emulator rewrite is debug only. */
object DevPairing {
  fun rewrite(raw: String): String = raw
}
