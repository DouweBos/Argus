package dev.houwert.argus.video

import android.content.Context
import android.media.MediaCodec
import android.media.MediaFormat
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.nio.ByteBuffer

/**
 * Renders the device stream with MediaCodec onto a SurfaceView. Access units
 * arrive length-prefixed (WebCodecs style) and are rewritten to Annex-B before
 * they're queued.
 */
class ArgusVideoView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), SurfaceHolder.Callback {

  private val onFirstFrame by EventDispatcher()

  private val surfaceView = SurfaceView(context)
  private var codec: MediaCodec? = null
  private var description: AvccDescription? = null
  private var pendingWidth = 0
  private var pendingHeight = 0
  private var surfaceReady = false
  /** MediaCodec must (re)start on a keyframe; drop deltas until one arrives. */
  private var awaitingKeyFrame = true
  private var reportedFirstFrame = false
  private val bufferInfo = MediaCodec.BufferInfo()

  init {
    addView(
      surfaceView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    surfaceView.holder.addCallback(this)
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    surfaceReady = true
    startCodecIfPossible()
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    surfaceReady = false
    releaseCodec()
  }

  fun configure(codecName: String, width: Int, height: Int, descriptionBytes: ByteArray) {
    // The gateway only ever encodes H.264; anything else would decode to noise.
    require(codecName.startsWith("avc")) { "unsupported codec: $codecName" }
    val parsed = AvccDescription.parse(descriptionBytes)
      ?: throw IllegalArgumentException("could not parse the stream's avcC description")
    description = parsed
    pendingWidth = width
    pendingHeight = height
    releaseCodec()
    startCodecIfPossible()
  }

  fun enqueue(data: ByteArray, isKeyFrame: Boolean, timestamp: Double) {
    val active = codec ?: return
    val avcc = description ?: return
    if (awaitingKeyFrame) {
      if (!isKeyFrame) {
        return
      }
      awaitingKeyFrame = false
    }

    val index = active.dequeueInputBuffer(0)
    if (index < 0) {
      // No free input buffer — shed this frame rather than blocking the bridge.
      return
    }
    val buffer: ByteBuffer = active.getInputBuffer(index) ?: return
    val annexB = avcc.toAnnexB(data)
    if (annexB.isEmpty() || buffer.capacity() < annexB.size) {
      active.queueInputBuffer(index, 0, 0, 0, 0)

      return
    }
    buffer.clear()
    buffer.put(annexB)
    active.queueInputBuffer(
      index,
      0,
      annexB.size,
      (timestamp * 1000).toLong(),
      if (isKeyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0,
    )

    drainOutput(active)
  }

  private fun drainOutput(active: MediaCodec) {
    while (true) {
      val outIndex = active.dequeueOutputBuffer(bufferInfo, 0)
      if (outIndex < 0) {
        return
      }
      active.releaseOutputBuffer(outIndex, true)
      if (!reportedFirstFrame) {
        reportedFirstFrame = true
        onFirstFrame(mapOf())
      }
    }
  }

  private fun startCodecIfPossible() {
    val avcc = description ?: return
    if (!surfaceReady || codec != null) {
      return
    }
    val format = MediaFormat.createVideoFormat(
      MediaFormat.MIMETYPE_VIDEO_AVC,
      pendingWidth.coerceAtLeast(1),
      pendingHeight.coerceAtLeast(1),
    )
    // csd-0 is the SPS, csd-1 the PPS — both Annex-B framed.
    format.setByteBuffer(
      "csd-0",
      ByteBuffer.wrap(AvccDescription.withStartCode(avcc.parameterSets[0])),
    )
    format.setByteBuffer(
      "csd-1",
      ByteBuffer.wrap(AvccDescription.withStartCode(avcc.parameterSets[1])),
    )

    val created = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    created.configure(format, surfaceView.holder.surface, null, 0)
    created.start()
    codec = created
    awaitingKeyFrame = true
  }

  private fun releaseCodec() {
    codec?.let {
      runCatching { it.stop() }
      runCatching { it.release() }
    }
    codec = null
    awaitingKeyFrame = true
  }
}
