// ArgusEncoder.m — VideoToolbox H.264 encoders for the captured framebuffer.
//
// The IOSurface is wrapped zero-copy in a CVPixelBuffer (see ArgusHID.m) and
// fed to up to two VTCompressionSessions:
//   - local:  quality-driven VBR, no bitrate cap — viewers on this machine.
//   - remote: average-bitrate capped, resolution/fps set by the host's
//             congestion controller — only runs while a remote viewer watches.
// Each output callback converts AVCC to Annex B (SPS/PPS ahead of keyframes),
// which is what the Node-side H264AccessUnitParser expects.

#import <stdatomic.h>
#import <pthread.h>
#import <Foundation/Foundation.h>
#import <VideoToolbox/VideoToolbox.h>
#import <CoreMedia/CoreMedia.h>
#import "ArgusEncoder.h"

typedef struct {
    const char *name;
    VTCompressionSessionRef session;
    int32_t srcW;      // source (IOSurface) dims — for change detection
    int32_t srcH;
    int32_t maxDim;    // longest encoded side; 0 = native
    int32_t bitrate;   // bits/s; 0 = quality-driven VBR, uncapped
    int32_t fps;       // 1..30, decimates the 30Hz capture
    bool rebuild;      // recreate the session on the next frame
    _Atomic(bool) forceKeyframe;
    _Atomic(SHEncodedCallback) callback;
} SHEncoder;

// 1920 keeps Retina mirrors crisp while roughly halving the encode cost of the
// largest devices (matches the Android capture path's maxSize default).
static SHEncoder g_local = { .name = "local", .maxDim = 1920, .fps = 30 };
static SHEncoder g_remote = { .name = "remote", .maxDim = 1280, .fps = 30 };

// Guards both encoders: frames arrive on the capture queue, parameter changes on
// the stdin thread. Output callbacks never take it, so teardown can't deadlock.
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static int64_t g_tick = 0;

static const uint8_t kAnnexBStartCode[4] = {0x00, 0x00, 0x00, 0x01};

/// Aspect-preserving, even H.264 encode dimensions for a source framebuffer.
static void _encodeDims(int32_t maxDim, int32_t sw, int32_t sh, int32_t *ew, int32_t *eh) {
    int32_t longest = sw > sh ? sw : sh;
    if (maxDim > 0 && longest > maxDim) {
        double scale = (double)maxDim / (double)longest;
        sw = (int32_t)(sw * scale);
        sh = (int32_t)(sh * scale);
    }
    sw &= ~1;  // H.264 requires even dimensions
    sh &= ~1;
    *ew = sw < 2 ? 2 : sw;
    *eh = sh < 2 ? 2 : sh;
}

/// VT output callback — runs on a VideoToolbox-managed thread.
static void _vtOutputCallback(void *outputCallbackRefCon,
                              void *sourceFrameRefCon,
                              OSStatus status,
                              VTEncodeInfoFlags infoFlags,
                              CMSampleBufferRef sampleBuffer) {
    SHEncoder *enc = (SHEncoder *)outputCallbackRefCon;
    SHEncodedCallback cb = atomic_load(&enc->callback);
    if (status != noErr || !sampleBuffer || !cb) return;
    if (!CMSampleBufferDataIsReady(sampleBuffer)) return;

    // A frame is a keyframe unless it is explicitly flagged NotSync.
    bool isKeyframe = true;
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, false);
    if (attachments && CFArrayGetCount(attachments) > 0) {
        CFDictionaryRef dict = (CFDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
        isKeyframe = !CFDictionaryContainsKey(dict, kCMSampleAttachmentKey_NotSync);
    }

    NSMutableData *out = [NSMutableData data];

    // SPS/PPS ahead of every keyframe so late joiners can configure a decoder.
    if (isKeyframe) {
        CMFormatDescriptionRef fmt = CMSampleBufferGetFormatDescription(sampleBuffer);
        size_t paramCount = 0;
        if (fmt && CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                fmt, 0, NULL, NULL, &paramCount, NULL) == noErr) {
            for (size_t i = 0; i < paramCount; i++) {
                const uint8_t *ps = NULL;
                size_t psLen = 0;
                if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                        fmt, i, &ps, &psLen, NULL, NULL) == noErr && ps) {
                    [out appendBytes:kAnnexBStartCode length:4];
                    [out appendBytes:ps length:psLen];
                }
            }
        }
    }

    // AVCC (4-byte length prefixes) → Annex B.
    CMBlockBufferRef bb = CMSampleBufferGetDataBuffer(sampleBuffer);
    size_t totalLen = 0;
    char *dataPtr = NULL;
    if (bb && CMBlockBufferGetDataPointer(bb, 0, NULL, &totalLen, &dataPtr) == noErr && dataPtr) {
        size_t offset = 0;
        while (offset + 4 <= totalLen) {
            uint32_t nalLen = ((uint32_t)(uint8_t)dataPtr[offset] << 24) |
                              ((uint32_t)(uint8_t)dataPtr[offset + 1] << 16) |
                              ((uint32_t)(uint8_t)dataPtr[offset + 2] << 8) |
                              ((uint32_t)(uint8_t)dataPtr[offset + 3]);
            offset += 4;
            if (offset + nalLen > totalLen) break;
            [out appendBytes:kAnnexBStartCode length:4];
            [out appendBytes:(dataPtr + offset) length:nalLen];
            offset += nalLen;
        }
    }

    if (out.length > 0) {
        cb((const uint8_t *)out.bytes, out.length);
    }
}

static void _setInt(VTCompressionSessionRef s, CFStringRef key, int32_t value) {
    CFNumberRef n = CFNumberCreate(NULL, kCFNumberSInt32Type, &value);
    VTSessionSetProperty(s, key, n);
    CFRelease(n);
}

/// Apply the bitrate cap and frame rate to a live session. Callable mid-stream.
static void _applyRate(SHEncoder *enc) {
    if (!enc->session) return;
    _setInt(enc->session, kVTCompressionPropertyKey_ExpectedFrameRate, enc->fps);
    if (enc->bitrate <= 0) return;

    _setInt(enc->session, kVTCompressionPropertyKey_AverageBitRate, enc->bitrate);
    // Hard ceiling at 1.5x the average over any 1s window: room for keyframes,
    // but a burst can't outrun the link the host measured.
    int64_t bytes = (int64_t)enc->bitrate * 3 / 16;
    double seconds = 1.0;
    CFNumberRef b = CFNumberCreate(NULL, kCFNumberSInt64Type, &bytes);
    CFNumberRef s = CFNumberCreate(NULL, kCFNumberFloat64Type, &seconds);
    const void *vals[] = { b, s };
    CFArrayRef limits = CFArrayCreate(NULL, vals, 2, &kCFTypeArrayCallBacks);
    OSStatus st = VTSessionSetProperty(enc->session, kVTCompressionPropertyKey_DataRateLimits, limits);
    if (st != noErr) {
        NSLog(@"[Encoder] %s: DataRateLimits unsupported (%d) — average only", enc->name, (int)st);
    }
    CFRelease(limits);
    CFRelease(b);
    CFRelease(s);
}

static void _teardown(SHEncoder *enc) {
    if (enc->session) {
        VTCompressionSessionCompleteFrames(enc->session, kCMTimeInvalid);
        VTCompressionSessionInvalidate(enc->session);
        CFRelease(enc->session);
        enc->session = NULL;
    }
    enc->srcW = 0;
    enc->srcH = 0;
}

/// Create the session lazily; recreate it when the source size or the encode
/// size changes. Returns NO on failure.
static BOOL _ensureSession(SHEncoder *enc, int32_t w, int32_t h) {
    if (enc->session && !enc->rebuild && enc->srcW == w && enc->srcH == h) return YES;
    _teardown(enc);
    enc->rebuild = false;

    int32_t ew, eh;
    _encodeDims(enc->maxDim, w, h, &ew, &eh);

    OSStatus st = VTCompressionSessionCreate(
        kCFAllocatorDefault, ew, eh, kCMVideoCodecType_H264,
        NULL, NULL, NULL, _vtOutputCallback, enc, &enc->session);
    if (st != noErr || !enc->session) {
        NSLog(@"[Encoder] %s: VTCompressionSessionCreate failed: %d", enc->name, (int)st);
        enc->session = NULL;
        return NO;
    }

    VTSessionSetProperty(enc->session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(enc->session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
    VTSessionSetProperty(enc->session, kVTCompressionPropertyKey_ProfileLevel,
                         kVTProfileLevel_H264_Main_AutoLevel);

    if (enc->bitrate <= 0) {
        // Quality-driven VBR: crisp text, near-zero bytes on static screens.
        // Kept below 1.0: at 1.0 VideoToolbox preserves the BGRA source's full
        // chroma and emits High 4:4:4 (profile 244), which WebCodecs can't
        // decode; 0.8 stays 4:2:0 while still visually lossless for UI.
        float quality = 0.8f;
        CFNumberRef qNum = CFNumberCreate(NULL, kCFNumberFloat32Type, &quality);
        VTSessionSetProperty(enc->session, kVTCompressionPropertyKey_Quality, qNum);
        CFRelease(qNum);
    }

    // Keyframe every 1s (time-based) for fast recovery and late-joiner startup.
    double kfDur = 1.0;
    CFNumberRef kfNum = CFNumberCreate(NULL, kCFNumberFloat64Type, &kfDur);
    VTSessionSetProperty(enc->session, kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, kfNum);
    CFRelease(kfNum);

    // Below native resolution VideoToolbox scales the source down (aspect is
    // preserved by _encodeDims, so Trim never crops).
    if (ew != w || eh != h) {
        const void *ks[] = { kVTPixelTransferPropertyKey_ScalingMode };
        const void *vs[] = { kVTScalingMode_Trim };
        CFDictionaryRef xfer = CFDictionaryCreate(NULL, ks, vs, 1,
            &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        VTSessionSetProperty(enc->session, kVTCompressionPropertyKey_PixelTransferProperties, xfer);
        CFRelease(xfer);
    }

    _applyRate(enc);
    VTCompressionSessionPrepareToEncodeFrames(enc->session);

    enc->srcW = w;
    enc->srcH = h;
    if (enc->bitrate > 0) {
        NSLog(@"[Encoder] %s: source %dx%d → encode %dx%d @ %d kbps, %d fps",
              enc->name, w, h, ew, eh, enc->bitrate / 1000, enc->fps);
    } else {
        NSLog(@"[Encoder] %s: source %dx%d → encode %dx%d (quality VBR)",
              enc->name, w, h, ew, eh);
    }
    return YES;
}

static void _encodeInto(SHEncoder *enc, CVPixelBufferRef pb, int32_t w, int32_t h, int64_t tick) {
    if (!atomic_load(&enc->callback)) return;
    int32_t stride = enc->fps >= 30 ? 1 : 30 / (enc->fps < 1 ? 1 : enc->fps);
    if (tick % stride != 0) return;
    if (!_ensureSession(enc, w, h)) return;

    CFDictionaryRef frameProps = NULL;
    if (atomic_exchange(&enc->forceKeyframe, false)) {
        const void *keys[1] = { kVTEncodeFrameOptionKey_ForceKeyFrame };
        const void *vals[1] = { kCFBooleanTrue };
        frameProps = CFDictionaryCreate(NULL, keys, vals, 1,
            &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    }
    // Both sessions share the capture clock, so a decimated stream keeps
    // real-time timestamps.
    VTCompressionSessionEncodeFrame(enc->session, pb, CMTimeMake(tick, 30), kCMTimeInvalid,
                                    frameProps, NULL, NULL);
    if (frameProps) CFRelease(frameProps);
}

void SHEncoderSetLocalCallback(SHEncodedCallback callback) {
    atomic_store(&g_local.callback, callback);
}

void SHEncoderEncode(CVPixelBufferRef pixelBuffer, int32_t width, int32_t height) {
    pthread_mutex_lock(&g_lock);
    int64_t tick = g_tick++;
    _encodeInto(&g_local, pixelBuffer, width, height, tick);
    _encodeInto(&g_remote, pixelBuffer, width, height, tick);
    pthread_mutex_unlock(&g_lock);
}

void SHEncoderStopAll(void) {
    pthread_mutex_lock(&g_lock);
    atomic_store(&g_local.callback, NULL);
    atomic_store(&g_remote.callback, NULL);
    _teardown(&g_local);
    _teardown(&g_remote);
    atomic_store(&g_local.forceKeyframe, false);
    atomic_store(&g_remote.forceKeyframe, false);
    g_tick = 0;
    pthread_mutex_unlock(&g_lock);
}

void SHRequestKeyframe(void) {
    atomic_store(&g_local.forceKeyframe, true);
}

void SHRequestRemoteKeyframe(void) {
    atomic_store(&g_remote.forceKeyframe, true);
}

/// Clamp and store remote parameters; caller holds g_lock.
static void _setRemoteParams(int32_t bitrate, int32_t maxDim, int32_t fps) {
    bitrate = bitrate < 100000 ? 100000 : bitrate;
    maxDim = maxDim <= 0 ? 0 : (maxDim < 160 ? 160 : maxDim);
    fps = fps < 1 ? 1 : (fps > 30 ? 30 : fps);

    if (maxDim != g_remote.maxDim) {
        g_remote.rebuild = true;
        atomic_store(&g_remote.forceKeyframe, true);
    }
    g_remote.maxDim = maxDim;
    g_remote.bitrate = bitrate;
    g_remote.fps = fps;
    if (!g_remote.rebuild) _applyRate(&g_remote);
}

void SHStartRemoteStream(SHEncodedCallback callback, int32_t bitrate,
                         int32_t maxDim, int32_t fps) {
    pthread_mutex_lock(&g_lock);
    _setRemoteParams(bitrate, maxDim, fps);
    atomic_store(&g_remote.forceKeyframe, true);
    atomic_store(&g_remote.callback, callback);
    pthread_mutex_unlock(&g_lock);
}

void SHSetRemoteStreamParams(int32_t bitrate, int32_t maxDim, int32_t fps) {
    pthread_mutex_lock(&g_lock);
    _setRemoteParams(bitrate, maxDim, fps);
    pthread_mutex_unlock(&g_lock);
    NSLog(@"[Encoder] remote: retarget %d kbps, max %d px, %d fps",
          bitrate / 1000, maxDim, fps);
}

void SHStopRemoteStream(void) {
    pthread_mutex_lock(&g_lock);
    atomic_store(&g_remote.callback, NULL);
    _teardown(&g_remote);
    pthread_mutex_unlock(&g_lock);
}
