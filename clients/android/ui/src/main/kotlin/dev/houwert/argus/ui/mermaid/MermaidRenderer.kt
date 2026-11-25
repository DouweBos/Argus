package dev.houwert.argus.ui.mermaid

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * Renders Mermaid diagrams, and rasterizes SVG files, in one off-screen WebView.
 *
 * Mermaid lays text out with the DOM, so there is no native port; the bundled `mermaid.min.js`
 * runs in a page with no network and hands back a PNG. A bitmap rather than a live web view per
 * diagram, so a transcript with twenty diagrams costs one web view.
 */
object MermaidRenderer {
  /** [widthDp] × [heightDp] is the diagram's own size; the bitmap holds [scale] pixels per dp. */
  class Diagram(val png: ByteArray, val widthDp: Float, val heightDp: Float, val scale: Float)

  sealed interface Outcome {
    class Rendered(val diagram: Diagram) : Outcome
    /** Mermaid's own message, for the fallback above the source. */
    data class Invalid(val message: String) : Outcome
  }

  /** Called once per diagram rendered (not a cache hit), with whether it failed. */
  @Volatile var onRender: ((failed: Boolean) -> Unit)? = null

  private data class Key(val source: String, val palette: MermaidPalette)

  private const val CACHE_LIMIT = 64
  private const val TIMEOUT_MS = 20_000L
  private val cache = object : LinkedHashMap<Key, Outcome>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, Outcome>) = size > CACHE_LIMIT
  }
  private val inFlight = HashMap<Key, Deferred<Outcome>>()
  private val serial = Mutex()
  private val main = Handler(Looper.getMainLooper())
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

  private var context: Context? = null
  private var webView: WebView? = null
  private var ready: CompletableDeferred<Unit>? = null
  private val pending = HashMap<String, CompletableDeferred<String>>()
  private var counter = 0

  /** Idempotent; the application context, so the renderer never holds an activity. */
  fun attach(context: Context) {
    if (this.context == null) this.context = context.applicationContext
  }

  /** The outcome already at hand, for a first frame without a spinner. Main thread only. */
  fun cached(source: String, palette: MermaidPalette): Outcome? = cache[Key(source.trim(), palette)]

  suspend fun render(source: String, palette: MermaidPalette): Outcome = withContext(Dispatchers.Main) {
    val key = Key(source.trim(), palette)
    cache[key] ?: (inFlight[key] ?: start(key)).await()
  }

  /** Outlives the caller: a row scrolled away mid-render still leaves its diagram in the cache. */
  private fun start(key: Key): Deferred<Outcome> =
    scope.async {
      val outcome = serial.withLock { cache[key] ?: run(key) }
      inFlight.remove(key)
      if (cache[key] == null) {
        cache[key] = outcome
        onRender?.invoke(outcome is Outcome.Invalid)
      }
      outcome
    }.also { inFlight[key] = it }

  /** An SVG file as a bitmap; null when it doesn't draw. */
  suspend fun rasterizeSvg(bytes: ByteArray): Diagram? = withContext(Dispatchers.Main) {
    val text = bytes.toString(Charsets.UTF_8)
    serial.withLock {
      val result = runCatching { call("argusRaster(${JSONObject.quote(text)})") }.getOrNull() ?: return@withLock null
      (outcome(result) as? Outcome.Rendered)?.diagram
    }
  }

  private suspend fun run(key: Key): Outcome =
    try {
      counter += 1
      val theme = JSONObject(key.palette.variables).toString()
      outcome(call("argusRender(${JSONObject.quote("argus$counter")}, ${JSONObject.quote(key.source)}, $theme)"))
    } catch (error: Exception) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      Outcome.Invalid(error.message ?: "Mermaid couldn't run.")
    }

  /** Runs [expression] (a promise) in the page; evaluateJavascript can't await, so the page posts back. */
  private suspend fun call(expression: String): String {
    prepare()
    val view = webView ?: throw IllegalStateException("The renderer isn't ready.")
    counter += 1
    val id = "r$counter"
    val reply = CompletableDeferred<String>()
    pending[id] = reply
    val script = """
      (async () => {
        let result;
        try { result = await $expression; } catch (e) { result = { error: String((e && e.message) || e) }; }
        argusBridge.deliver(${JSONObject.quote(id)}, JSON.stringify(result || {}));
      })(); void 0;
    """.trimIndent()
    view.evaluateJavascript(script, null)
    return try {
      withTimeoutOrNull(TIMEOUT_MS) { reply.await() } ?: throw IllegalStateException("Mermaid took too long to draw this.")
    } finally {
      pending.remove(id)
    }
  }

  private suspend fun prepare() {
    val waiting = ready ?: CompletableDeferred<Unit>().also {
      ready = it
      try {
        load(it)
      } catch (error: Exception) {
        ready = null
        it.completeExceptionally(error)
      }
    }
    try {
      waiting.await()
    } catch (error: Exception) {
      if (ready === waiting) reset()
      throw error
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun load(loaded: CompletableDeferred<Unit>) {
    val context = context ?: throw IllegalStateException("The renderer isn't attached.")
    val library = runCatching { context.assets.open("mermaid/mermaid.min.js").bufferedReader().use { it.readText() } }
      .getOrElse { throw IllegalStateException("Mermaid isn't bundled with this build.") }
    val view = WebView(context)
    view.settings.apply {
      javaScriptEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      blockNetworkLoads = true
      blockNetworkImage = true
      domStorageEnabled = false
      cacheMode = WebSettings.LOAD_NO_CACHE
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      setGeolocationEnabled(false)
    }
    // Off screen it still needs a size, or layout-dependent text measuring returns zeros.
    view.layout(0, 0, 800, 600)
    view.addJavascriptInterface(Bridge, "argusBridge")
    view.webViewClient = object : WebViewClient() {
      private var injected = false

      override fun onPageFinished(view: WebView, url: String?) {
        if (injected) return
        injected = true
        view.evaluateJavascript(library + "\n" + GLUE + "\n;'ok'") { result ->
          if (result == "\"ok\"") loaded.complete(Unit) else loaded.completeExceptionally(IllegalStateException("Mermaid didn't load."))
        }
      }

      // Nothing leaves the page: no fetches, no navigation.
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        if (request.url.scheme == "data") null else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // Loaded again on the next render.
        if (webView === view) reset()
        view.destroy()
        return true
      }
    }
    webView = view
    view.loadDataWithBaseURL(null, PAGE, "text/html", "utf-8", null)
  }

  private fun reset() {
    webView = null
    ready = null
    pending.values.forEach { it.completeExceptionally(IllegalStateException("The renderer stopped.")) }
    pending.clear()
  }

  private object Bridge {
    @JavascriptInterface
    fun deliver(id: String, json: String) {
      main.post { pending.remove(id)?.complete(json) }
    }
  }

  internal fun outcome(json: String): Outcome {
    val result = runCatching { JSONObject(json) }.getOrNull() ?: return Outcome.Invalid("Mermaid returned nothing.")
    result.optString("error").takeIf { result.has("error") && it.isNotEmpty() }?.let { return Outcome.Invalid(tidy(it)) }
    val png = result.optString("png").takeIf { it.isNotEmpty() }?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }
    val width = result.optDouble("width")
    val height = result.optDouble("height")
    val scale = result.optDouble("scale")
    if (png == null || width.isNaN() || height.isNaN() || scale.isNaN()) return Outcome.Invalid("Mermaid returned nothing.")
    return Outcome.Rendered(Diagram(png, width.toFloat(), height.toFloat(), scale.toFloat()))
  }

  /** Mermaid's parse errors end in a long list of expected tokens nobody reads. */
  internal fun tidy(message: String): String = message.trim().substringBefore("\nExpecting ")

  /** No network, no frames, no forms: the bundled library is the only script. */
  private const val PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<style>body{margin:0;background:transparent;font-family:Roboto,system-ui,sans-serif}</style>
</head><body><div id="stage"></div></body></html>"""

  /** Labels as SVG text, not HTML in `foreignObject`, so the picture can be drawn to a canvas. */
  private const val GLUE = """
window.argusRender = async (id, source, theme) => {
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    theme: 'base', themeVariables: theme, htmlLabels: false,
    flowchart: { htmlLabels: false }, class: { htmlLabels: false },
    fontFamily: 'Roboto, system-ui, sans-serif',
    themeCSS: '.edgeLabel rect, .labelBkg { opacity: 1 !important; }'
  });
  try { await mermaid.parse(source); } catch (e) { return { error: String((e && e.message) || e) }; }
  try {
    const { svg } = await mermaid.render(id, source, document.getElementById('stage'));
    return await argusRaster(svg);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  } finally {
    document.getElementById('stage').replaceChildren();
    document.getElementById('d' + id)?.remove();
  }
};
window.argusRaster = async (markup) => {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return { error: 'Not an SVG image.' };
  const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  let width = parseFloat(svg.getAttribute('width')), height = parseFloat(svg.getAttribute('height'));
  if (box.length === 4 && box[2] > 0 && box[3] > 0) {
    if (!(width > 0) || String(svg.getAttribute('width')).includes('%')) width = box[2];
    if (!(height > 0) || String(svg.getAttribute('height')).includes('%')) height = box[3];
  }
  if (!(width > 0 && height > 0)) { width = 300; height = 150; }
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.style.maxWidth = '';
  const xml = new XMLSerializer().serializeToString(svg);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch (e) { return { error: 'The image could not be drawn.' }; }
  const scale = Math.max(1, Math.min(3, Math.sqrt(16e6 / (width * height))));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  const png = canvas.toDataURL('image/png').split(',')[1];
  return { png, width, height, scale };
};
"""
}
