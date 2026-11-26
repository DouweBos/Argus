package dev.houwert.argus.ui.files

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import dev.houwert.argus.core.files.MarkdownTarget
import dev.houwert.argus.core.files.SessionFilePaths
import dev.houwert.argus.ui.transcript.MarkdownDocument
import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking

/** The page's origin: requests to it are answered from the worktree, never the network. */
private const val ORIGIN = "https://argus-preview.invalid/"

/** Worktree-relative path of a URL on [ORIGIN]; null for anything else or anything climbing out. */
internal fun previewPath(url: Uri): String? {
  if (url.scheme != "https" || url.host != "argus-preview.invalid") return null
  return SessionFilePaths.normalized(url.path.orEmpty().trimStart('/'))
}

internal fun previewMimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
  "html", "htm" -> "text/html"
  "css" -> "text/css"
  "js", "mjs" -> "text/javascript"
  "json" -> "application/json"
  "svg" -> "image/svg+xml"
  "png" -> "image/png"
  "jpg", "jpeg" -> "image/jpeg"
  "gif" -> "image/gif"
  "webp" -> "image/webp"
  "woff2" -> "font/woff2"
  else -> "application/octet-stream"
}

/**
 * An HTML page from a worktree in a web view that can't reach the network unless [allowNetwork].
 * The page loads from a placeholder origin answered only from the worktree, so relative scripts,
 * styles and images resolve; scripts run, but with no network and no storage have nowhere to send
 * anything. Links to other worktree files and the web go through [document]'s `open`.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SandboxedHtmlView(html: String, document: MarkdownDocument, allowNetwork: Boolean, modifier: Modifier = Modifier) {
  // Read by the client on WebView's threads, so it sees the latest text without a new client.
  val current = remember { Current(html, allowNetwork) }
  current.html = html
  current.allowNetwork = allowNetwork
  AndroidView(
    factory = { context ->
      WebView(context).apply {
        settings.apply {
          javaScriptEnabled = true
          allowFileAccess = false
          allowContentAccess = false
          domStorageEnabled = false
          cacheMode = WebSettings.LOAD_NO_CACHE
          javaScriptCanOpenWindowsAutomatically = false
          setSupportMultipleWindows(false)
          setGeolocationEnabled(false)
        }
        webViewClient = object : WebViewClient() {
          override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val path = previewPath(request.url)
            if (path == null) {
              val inline = request.url.scheme == "data" || request.url.scheme == "blob"
              return if (inline || current.allowNetwork) null else blocked()
            }
            val bytes = if (path == document.path) current.html.toByteArray() else runBlocking { document.loadFile(path) }
            bytes ?: return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            return WebResourceResponse(previewMimeType(path), "utf-8", ByteArrayInputStream(bytes))
          }

          override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val path = previewPath(request.url)
            when {
              path == document.path -> return false
              path != null -> document.open(MarkdownTarget.File(path))
              request.url.scheme in setOf("http", "https", "mailto") -> document.open(MarkdownTarget.External(request.url.toString()))
            }
            return true
          }
        }
      }
    },
    update = { view ->
      view.settings.blockNetworkLoads = !allowNetwork
      val key = "$allowNetwork\u0000$html"
      if (view.tag != key) {
        view.tag = key
        view.loadUrl(ORIGIN + document.path.split('/').joinToString("/") { Uri.encode(it) })
      }
    },
    modifier = modifier,
    onRelease = { it.destroy() },
  )
}

private class Current(@Volatile var html: String, @Volatile var allowNetwork: Boolean)

private fun blocked() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
