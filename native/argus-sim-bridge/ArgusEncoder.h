#ifndef ARGUS_ENCODER_H
#define ARGUS_ENCODER_H

#include <stdbool.h>
#include <stdint.h>
#include <CoreVideo/CoreVideo.h>

/// Receives one encoded access unit as H.264 Annex B (SPS/PPS before keyframes).
typedef void (*SHEncodedCallback)(const uint8_t *data, uintptr_t len);

/// Route the local (uncapped, quality-VBR) stream to `callback`; NULL stops it.
void SHEncoderSetLocalCallback(SHEncodedCallback callback);

/// Encode one captured framebuffer into every active stream. Called at ~30Hz
/// from the capture queue; `width`/`height` are the source surface dims.
void SHEncoderEncode(CVPixelBufferRef pixelBuffer, int32_t width, int32_t height);

/// Tear down every compression session and stop both streams (capture ended).
void SHEncoderStopAll(void);

/// Force the next local frame to be a keyframe (a new local client connected).
void SHRequestKeyframe(void);

/// Start the bitrate-capped stream for remote viewers. Idempotent: a running
/// stream just takes the new parameters. `maxDim` caps the longest encoded side
/// and `fps` (1..30) decimates the 30Hz capture.
void SHStartRemoteStream(SHEncodedCallback callback, int32_t bitrate,
                         int32_t maxDim, int32_t fps);

/// Retarget the remote stream live. A new `maxDim` rebuilds the session, which
/// starts on a keyframe carrying the new SPS/PPS.
void SHSetRemoteStreamParams(int32_t bitrate, int32_t maxDim, int32_t fps);

/// Stop encoding the remote stream; the local stream is unaffected.
void SHStopRemoteStream(void);

/// Force the next remote frame to be a keyframe.
void SHRequestRemoteKeyframe(void);

#endif
