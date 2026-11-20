package dev.houwert.argus.ui.transcript

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Message
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.houwert.argus.kit.util.ArtifactLink
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Sign-in popups stay in the page; anything else opens in the browser. */
private val signInHosts = listOf("claude.ai", "anthropic.com", "accounts.google.com", "appleid.apple.com")

internal fun isSignInHost(host: String?): Boolean =
  host != null && signInHosts.any { host == it || host.endsWith(".$it") }

/** One Artifact page's web view and what the chrome around it reads. Cookies persist, so a claude.ai sign-in lasts. */
@Stable
class ArtifactPage(val url: String) {
  var isLoading by mutableStateOf(false)
    internal set
  var failure by mutableStateOf<String?>(null)
    internal set
  internal var webView: WebView? = null

  fun reload() {
    failure = null
    val view = webView ?: return
    if (view.url == null) view.loadUrl(url) else view.reload()
  }
}

/**
 * An Artifact as the agent published it: a slim bar (title, reload, open in the browser) over the
 * live page. [onClose] is the sheet's close button.
 */
@Composable
fun ArtifactViewer(link: ArtifactLink, modifier: Modifier = Modifier, onClose: (() -> Unit)? = null) {
  val theme = ArgusTheme.colors
  val uri = LocalUriHandler.current
  val page = remember(link.url) { ArtifactPage(link.url) }
  Column(modifier.background(theme.bg)) {
    Row(
      Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(Icon.artifact, null, Modifier.size(13.dp), tint = theme.accent)
      Text(link.title, Modifier.weight(1f, fill = false), color = theme.text, style = argusFont(13, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (page.isLoading) CircularProgressIndicator(Modifier.size(12.dp), color = theme.textMuted, strokeWidth = 1.5.dp)
      Box(Modifier.weight(1f))
      IconBtn(Icon.refresh, "Reload", size = 17.dp) { page.reload() }
      IconBtn(Icon.openExternal, "Open in Browser", size = 17.dp) { runCatching { uri.openUri(link.url) } }
      if (onClose != null) IconBtn(Icon.close, "Close", size = 17.dp, onClick = onClose)
    }
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(theme.border))
    Box(Modifier.weight(1f).fillMaxWidth()) {
      ArtifactWebView(page) { runCatching { uri.openUri(it) } }
      val failure = page.failure
      if (failure != null) {
        Box(Modifier.fillMaxSize().background(theme.bg)) {
          EmptyState(Icon.warning, "Couldn't load the artifact", body = failure) {
            Btn("Try Again", tone = ButtonTone.Secondary, hugs = true) { page.reload() }
          }
        }
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ArtifactWebView(page: ArtifactPage, openExternal: (String) -> Unit) {
  val context = LocalContext.current
  val view = remember(page) {
    WebView(context).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.setSupportMultipleWindows(true)
      // Google refuses sign-in from a user agent marked as a web view.
      settings.userAgentString = settings.userAgentString.replace("; wv", "")
      CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
      setBackgroundColor(android.graphics.Color.TRANSPARENT)
      webViewClient = object : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
          page.isLoading = true
          page.failure = null
        }

        override fun onPageFinished(view: WebView, url: String?) {
          page.isLoading = false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
          if (!request.isForMainFrame) return
          page.isLoading = false
          page.failure = error.description?.toString() ?: "The page didn't load."
        }
      }
      webChromeClient = object : WebChromeClient() {
        // A popup: sign-in stays here, anything else goes to the browser.
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean {
          val target = view.hitTestResult.extra
          if (target != null) {
            if (isSignInHost(android.net.Uri.parse(target).host)) view.loadUrl(target) else openExternal(target)
            return false
          }
          // No link under the tap (a scripted window.open): catch its first navigation instead.
          val catcher = WebView(view.context)
          catcher.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
              val url = request.url.toString()
              if (isSignInHost(request.url.host)) view.loadUrl(url) else openExternal(url)
              v.destroy()
              return true
            }
          }
          val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
          transport.webView = catcher
          resultMsg.sendToTarget()
          return true
        }
      }
      loadUrl(page.url)
    }
  }
  DisposableEffect(view) {
    page.webView = view
    onDispose {
      page.webView = null
      view.destroy()
    }
  }
  AndroidView({ view }, Modifier.fillMaxSize())
}

/** The artifact full screen over the transcript, as the phone's sheet. */
@Composable
internal fun ArtifactSheet(link: ArtifactLink, onDismiss: () -> Unit) {
  Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    ArtifactViewer(link, Modifier.fillMaxSize().background(ArgusTheme.colors.bg).statusBarsPadding().navigationBarsPadding(), onClose = onDismiss)
  }
}
