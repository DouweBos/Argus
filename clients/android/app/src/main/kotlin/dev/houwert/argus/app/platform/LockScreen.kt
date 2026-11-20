package dev.houwert.argus.app.platform

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * The app lock: opportunistic, like the iPhone's. With nothing enrolled there is
 * no gate, rather than a second password the user never set.
 */
object AppLock {
  private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

  fun available(activity: FragmentActivity): Boolean =
    BiometricManager.from(activity).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

  fun authenticate(activity: FragmentActivity, onUnlocked: () -> Unit) {
    val prompt = BiometricPrompt(
      activity,
      ContextCompat.getMainExecutor(activity),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onUnlocked()
      },
    )
    prompt.authenticate(
      BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Argus").setAllowedAuthenticators(AUTHENTICATORS).build(),
    )
  }
}

/** Argus is the hundred-eyed watchman, so the locked state is an eye that keeps watch. */
@Composable
fun LockScreen(onUnlock: () -> Unit) {
  val theme = ArgusTheme.colors
  val rings = rememberInfiniteTransition(label = "rings")
  val phase by rings.animateFloat(0f, 1f, infiniteRepeatable(tween(2600, easing = LinearEasing), RepeatMode.Restart), label = "phase")
  Box(
    Modifier
      .fillMaxSize()
      .background(theme.bg)
      .background(Brush.radialGradient(listOf(theme.accent.copy(alpha = 0.16f), theme.bg.copy(alpha = 0f))))
      .safeDrawingPadding(),
  ) {
    Column(
      Modifier.fillMaxSize().padding(horizontal = 24.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
      Spacer(Modifier.weight(1f))
      Box(Modifier.size(168.dp), contentAlignment = Alignment.Center) {
        for (index in 0 until 2) {
          val local = (phase + index * 0.5f) % 1f
          Box(
            Modifier
              .size(168.dp)
              .scale(0.62f + local * 0.43f)
              .border(1.dp, theme.accent.copy(alpha = (1 - local) * 0.5f), CircleShape),
          )
        }
        Box(Modifier.size(96.dp).background(theme.accentSoft, CircleShape), contentAlignment = Alignment.Center) {
          Icon(ArgusIcon.eye, contentDescription = null, tint = theme.accent, modifier = Modifier.size(34.dp))
        }
      }
      Badge("Locked")
      TitleText("Argus")
      MutedText("Your agents keep working while you're away. Unlock to look in on them.", Modifier.padding(horizontal = 8.dp))
      Spacer(Modifier.weight(1f))
      Btn("Unlock", fills = true, onClick = onUnlock)
      MutedText("Nothing leaves this phone unencrypted.", Modifier.padding(bottom = 8.dp))
    }
  }
}
