package dev.houwert.argus.kit.account

/**
 * The sign-in provider behind an account: Clerk in the app, a fake in tests.
 * Only its session token ever reaches the account service.
 */
interface AccountAuthenticating {
  /** Point the provider at the account's Clerk instance (from `GET /config`). */
  suspend fun configure(config: AccountServiceConfig)
  /** A session is live. Only identity actions need one; a member device works without. */
  val isSignedIn: Boolean
  /** With an identity token from a native Apple sign-in, or null to run Apple's web flow. */
  suspend fun signInWithApple(idToken: String?)
  suspend fun signInWithGitHub()
  suspend fun sendEmailCode(email: String)
  suspend fun verifyEmailCode(code: String)
  /** A short-lived session JWT for `Authorization: Bearer`. */
  suspend fun token(): String?
  suspend fun signOut()
  /** Who is signed in, for the account header. Shown on this device only. */
  val profile: AccountProfile? get() = null
  /** Whether the session proved its first factor within [minutes] (Clerk's `fva`). */
  fun isReverified(withinMinutes: Int): Boolean = false
  /** Step-up for a sensitive action: email a code; returns where it went. */
  suspend fun startReverification(): String = throw AccountReverifyError.Unavailable
  /** Finish the step-up; the next [token] carries the fresh factor age. */
  suspend fun finishReverification(code: String): Unit = throw AccountReverifyError.Unavailable
}

sealed class AccountReverifyError(message: String) : Exception(message) {
  /** The sign-in has no email address to send a code to, or the provider can't step up. */
  data object Unavailable : AccountReverifyError("unavailable")
  data object Incomplete : AccountReverifyError("incomplete")
}

/** The signed-in person as the sign-in provider knows them. Never leaves the device. */
data class AccountProfile(
  val firstName: String? = null,
  val lastName: String? = null,
  val username: String? = null,
  val email: String? = null,
  val imageUrl: String? = null,
) {
  /** First and last name, else the username, else the email. */
  val displayName: String?
    get() = clean(listOfNotNull(clean(firstName), clean(lastName)).joinToString(" ")) ?: clean(username) ?: clean(email)

  /** The email, unless it is already the display name. */
  val subtitle: String? get() = clean(email)?.takeIf { it != displayName }

  /** One or two letters for an avatar without a picture. */
  val initials: String
    get() {
      val names = listOfNotNull(clean(firstName), clean(lastName))
      val letters = if (names.isEmpty()) listOfNotNull(displayName?.firstOrNull()) else names.map { it.first() }
      return letters.take(2).joinToString("").uppercase()
    }

  private fun clean(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }
}

enum class AccountSignInProvider(val raw: String) { Apple("apple"), GitHub("github"), Email("email") }
