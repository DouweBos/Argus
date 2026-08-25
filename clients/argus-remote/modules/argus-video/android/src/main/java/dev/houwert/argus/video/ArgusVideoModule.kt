package dev.houwert.argus.video

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridges the device-screen stream to a native H.264 surface. Frames are
 * decrypted in JS, so they're passed in as typed arrays rather than pulled
 * from a URL.
 */
class ArgusVideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArgusVideo")

    View(ArgusVideoView::class) {
      Events("onFirstFrame")

      AsyncFunction("configure") {
        view: ArgusVideoView,
        codec: String,
        width: Int,
        height: Int,
        description: ByteArray,
        ->
        view.configure(codec, width, height, description)
      }

      AsyncFunction("enqueue") {
        view: ArgusVideoView, data: ByteArray, isKeyFrame: Boolean, timestamp: Double ->
        view.enqueue(data, isKeyFrame, timestamp)
      }
    }
  }
}
