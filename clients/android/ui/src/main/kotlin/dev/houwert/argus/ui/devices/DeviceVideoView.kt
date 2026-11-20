package dev.houwert.argus.ui.devices

import android.graphics.BitmapFactory
import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.Surface
import android.view.TextureView
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import dev.houwert.argus.kit.media.AvccDescription
import dev.houwert.argus.kit.media.MediaMessage
import java.nio.ByteBuffer

/**
 * Feeds one stream into a [DeviceVideoView]: H.264 into a MediaCodec decoder on
 * its own thread, a browser's JPEGs into a bitmap. Call [receive] on the main thread.
 */
class DeviceVideoHandle {
  /** The latest browser frame, when the stream is JPEG. */
  var jpeg by mutableStateOf<ImageBitmap?>(null)
    private set
  internal var onFirstFrame: () -> Unit = {}

  private val thread = HandlerThread("argus-video").apply { start() }
  private val decoderThread = Handler(thread.looper)
  private val main = Handler(Looper.getMainLooper())
  private var decoder: H264Decoder? = null
  private var surface: Surface? = null
  private var config: MediaMessage.Config? = null
  /** Replayed into a fresh decoder when the surface comes back. */
  private val sinceKeyFrame = ArrayDeque<MediaMessage.Frame>()
  private var firstFrameSent = false

  fun receive(message: MediaMessage) {
    when (message) {
      is MediaMessage.Config -> {
        config = message
        sinceKeyFrame.clear()
        restartDecoder()
      }
      is MediaMessage.Frame -> {
        if (message.keyFrame) sinceKeyFrame.clear()
        if (sinceKeyFrame.size < REPLAY_CAP) sinceKeyFrame.addLast(message)
        decoder?.let { d -> decoderThread.post { d.enqueue(message) } }
      }
      is MediaMessage.Jpeg -> {
        val bytes = message.data
        decoderThread.post {
          val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() ?: return@post
          main.post {
            jpeg = bitmap
            firstFrame()
          }
        }
      }
    }
  }

  internal fun surfaceAvailable(value: Surface) {
    surface = value
    restartDecoder()
  }

  internal fun surfaceDestroyed() {
    surface = null
    stopDecoder()
  }

  /** Stop decoding for good; the handle is unusable after this. */
  fun release() {
    stopDecoder()
    thread.quitSafely()
  }

  private fun restartDecoder() {
    stopDecoder()
    val config = config ?: return
    val surface = surface ?: return
    val replay = sinceKeyFrame.toList()
    val next = H264Decoder(surface, decoderThread) { main.post { firstFrame() } }
    decoder = next
    decoderThread.post {
      next.configure(config)
      replay.forEach(next::enqueue)
    }
  }

  private fun stopDecoder() {
    val old = decoder ?: return
    decoder = null
    decoderThread.post { old.release() }
  }

  private fun firstFrame() {
    if (firstFrameSent) return
    firstFrameSent = true
    onFirstFrame()
  }

  private companion object { const val REPLAY_CAP = 300 }
}

/** One MediaCodec session; every call runs on the decoder thread. */
private class H264Decoder(private val surface: Surface, private val handler: Handler, private val onRendered: () -> Unit) {
  private var codec: MediaCodec? = null
  private var nalLengthSize = 4
  private val freeInputs = ArrayDeque<Int>()
  private val pending = ArrayDeque<MediaMessage.Frame>()
  /** A decoder handed a delta before its first keyframe produces only artefacts. */
  private var awaitingKeyFrame = true
  private var rendered = false

  fun configure(config: MediaMessage.Config) {
    // Only AVC comes over this channel; anything else is a host bug, not something to guess at.
    if (!config.codec.startsWith("avc")) return
    val parsed = AvccDescription.parse(config.description) ?: return
    nalLengthSize = parsed.nalUnitLengthSize
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, config.codedWidth, config.codedHeight)
    format.setByteBuffer("csd-0", ByteBuffer.wrap(parsed.annexB(0)))
    if (parsed.parameterSets.size > 1) format.setByteBuffer("csd-1", ByteBuffer.wrap(parsed.annexB(1)))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
    val codec = runCatching { MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC) }.getOrNull() ?: return
    codec.setCallback(
      object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
          freeInputs.addLast(index)
          pump()
        }

        override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
          runCatching { codec.releaseOutputBuffer(index, true) }
          if (!rendered && info.size > 0) {
            rendered = true
            onRendered()
          }
        }

        override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
          // A failed codec never recovers by itself; wait for the next keyframe on a reset one.
          freeInputs.clear()
          pending.clear()
          awaitingKeyFrame = true
          runCatching { codec.reset(); codec.configure(format, surface, null, 0); codec.start() }
        }

        override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {}
      },
      handler,
    )
    if (runCatching { codec.configure(format, surface, null, 0); codec.start() }.isFailure) {
      codec.release()
      return
    }
    this.codec = codec
  }

  fun enqueue(frame: MediaMessage.Frame) {
    if (codec == null) return
    if (awaitingKeyFrame) {
      if (!frame.keyFrame) return
      awaitingKeyFrame = false
    }
    // A decoder that falls far behind shows stale frames; skip to the next keyframe instead.
    if (pending.size > BACKLOG_CAP) {
      pending.clear()
      awaitingKeyFrame = !frame.keyFrame
      if (awaitingKeyFrame) return
    }
    pending.addLast(frame)
    pump()
  }

  private fun pump() {
    val codec = codec ?: return
    while (freeInputs.isNotEmpty() && pending.isNotEmpty()) {
      val frame = pending.removeFirst()
      val data = AvccDescription.toAnnexB(frame.data, nalLengthSize) ?: continue
      val index = freeInputs.removeFirst()
      runCatching {
        val buffer = codec.getInputBuffer(index) ?: return@runCatching
        buffer.clear()
        if (data.size > buffer.capacity()) return@runCatching codec.queueInputBuffer(index, 0, 0, 0, 0)
        buffer.put(data)
        val flags = if (frame.keyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        // Timestamps arrive in milliseconds on the wire.
        codec.queueInputBuffer(index, 0, data.size, (frame.timestamp * 1000).toLong(), flags)
      }
    }
  }

  fun release() {
    runCatching { codec?.stop() }
    runCatching { codec?.release() }
    codec = null
  }

  private companion object { const val BACKLOG_CAP = 30 }
}

/**
 * A live device's picture: the decoded H.264 stream on a TextureView (so it can be
 * rotated and scaled like any other node), or the browser's latest JPEG.
 */
@Composable
fun DeviceVideoView(handle: DeviceVideoHandle, modifier: Modifier = Modifier, onFirstFrame: () -> Unit = {}) {
  val firstFrame by rememberUpdatedState(onFirstFrame)
  handle.onFirstFrame = { firstFrame() }
  DisposableEffect(handle) { onDispose { handle.surfaceDestroyed() } }
  val jpeg = handle.jpeg
  if (jpeg != null) {
    Image(jpeg, contentDescription = "Live picture", modifier.fillMaxSize(), contentScale = ContentScale.Fit)
    return
  }
  AndroidView(
    modifier = modifier,
    factory = { context ->
      TextureView(context).apply {
        contentDescription = "Live device picture"
        surfaceTextureListener = object : TextureView.SurfaceTextureListener {
          override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
            handle.surfaceAvailable(Surface(texture))
          }

          override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {}

          override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
            handle.surfaceDestroyed()
            return true
          }

          override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}
        }
      }
    },
  )
}
