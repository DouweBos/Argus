// ArgusHID.m — ObjC helpers for HID messaging and IOSurface framebuffer
// capture. Lives in ObjC to avoid Swift ARC issues with objc_msgSend and to
// properly work with CoreSimulator's XPC proxy objects.
//
// Framebuffer path:
//   SimDeviceIOClient → ioPorts → find "com.apple.framebuffer.display" →
//   descriptor (SimDisplayIOSurfaceRenderable) → framebufferSurface → IOSurface
//
// The descriptor's `framebufferSurface` returns a live IOSurface backed by a
// Mach port transferred over XPC from the simulator service process.

#import <stdatomic.h>
#import <mach/mach_time.h>
#import <objc/message.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <CoreGraphics/CoreGraphics.h>
#import <AppKit/AppKit.h>
#import <VideoToolbox/VideoToolbox.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>

// ---------------------------------------------------------------------------
// MARK: - HID touch injection
// ---------------------------------------------------------------------------

// Function pointer type for IndigoHIDMessageForMouseNSEvent.
// Args: point, prevMsg, 0x32, nsEventType, direction → 320-byte static buffer.
// prevMsg: NULL for mouseDown (new touch), previous message for drag/up (continuity).
// IndigoHIDMessageForMouseNSEvent takes 4 trailing `double` args (scale/pressure)
// beyond the visible params. They land in FP registers d0–d3 per the ARM64
// calling convention; the function requires them = 1.0 or the built touch has no
// effect (event "sends" fine but never registers). Declaring them here makes the
// compiler pass 1.0 properly — the previous code set d0–d3 via inline asm, which
// a refactor removed, silently breaking all touch injection.
typedef void* (*IndigoMouseFn)(CGPoint*, void*, int, int, int,
                               double, double, double, double);

// Per-simulator touch state.  Keyed by UDID so multiple simulators can have
// independent touch sequences without interfering with each other.
typedef struct {
    char udid[64];
    void *lastIndigoMsg;
    uint64_t lastTouchTime;
    _Atomic(bool) invalid;
} SHTouchState;

#define MAX_TOUCH_STATES 8
static SHTouchState g_touchStates[MAX_TOUCH_STATES];
static int g_touchStateCount = 0;

/// Find (or create) the touch state for a UDID.  Must be called on the main thread.
static SHTouchState *_touchStateForUDID(const char *udid) {
    for (int i = 0; i < g_touchStateCount; i++) {
        if (strcmp(g_touchStates[i].udid, udid) == 0) {
            return &g_touchStates[i];
        }
    }
    // Create new entry
    if (g_touchStateCount < MAX_TOUCH_STATES) {
        SHTouchState *s = &g_touchStates[g_touchStateCount++];
        strlcpy(s->udid, udid, sizeof(s->udid));
        s->lastIndigoMsg = NULL;
        s->lastTouchTime = 0;
        atomic_store(&s->invalid, false);
        return s;
    }
    // Evict oldest (slot 0) and shift — unlikely to hit with ≤8 simulators.
    // Free its owned continuity snapshot first so eviction doesn't leak.
    if (g_touchStates[0].lastIndigoMsg) {
        free(g_touchStates[0].lastIndigoMsg);
        g_touchStates[0].lastIndigoMsg = NULL;
    }
    for (int i = 1; i < MAX_TOUCH_STATES; i++) {
        g_touchStates[i - 1] = g_touchStates[i];
    }
    SHTouchState *s = &g_touchStates[MAX_TOUCH_STATES - 1];
    strlcpy(s->udid, udid, sizeof(s->udid));
    s->lastIndigoMsg = NULL;
    s->lastTouchTime = 0;
    atomic_store(&s->invalid, false);
    return s;
}

// Minimum nanoseconds between IndigoHIDMessageForMouseNSEvent calls.
// The function's internal threshold is ~16ms.  We use 17ms for safety.
#define INDIGO_MIN_INTERVAL_NS 17000000ULL

// Reverse-engineered sizes of the Indigo HID message buffers returned by
// IndigoHIDMessageForMouseNSEvent (touch) and IndigoHIDMessageForKeyboardNSEvent
// (keyboard). These are the fixed static-buffer sizes observed in the
// SimulatorKit disassembly; the functions return a pointer into that buffer.
// We only ever copy exactly this many bytes, so an under-read is the failure
// mode to guard against — we NULL-check the returned pointer before copying.
#define SH_TOUCH_MSG_SIZE 320
#define SH_KEYBOARD_MSG_SIZE 192

static void _ensureTimebase(mach_timebase_info_data_t *out) {
    static mach_timebase_info_data_t s_timebase;
    static dispatch_once_t s_once;
    dispatch_once(&s_once, ^{
        mach_timebase_info(&s_timebase);
    });
    *out = s_timebase;
}

/// Check whether the HID client for a specific UDID has been invalidated.
bool SHIsHIDClientInvalidForUDID(const char *udid) {
    for (int i = 0; i < g_touchStateCount; i++) {
        if (strcmp(g_touchStates[i].udid, udid) == 0) {
            return atomic_load(&g_touchStates[i].invalid);
        }
    }
    return false;
}

/// Reset the invalidation flag for a specific UDID.
void SHResetHIDClientInvalidForUDID(const char *udid) {
    SHTouchState *s = _touchStateForUDID(udid);
    atomic_store(&s->invalid, false);
}

/// Clear touch sequence state for a specific UDID after invalidation.
void SHClearTouchStateForUDID(const char *udid) {
    for (int i = 0; i < g_touchStateCount; i++) {
        if (strcmp(g_touchStates[i].udid, udid) == 0) {
            if (g_touchStates[i].lastIndigoMsg) {
                free(g_touchStates[i].lastIndigoMsg);
            }
            g_touchStates[i].lastIndigoMsg = NULL;
            g_touchStates[i].lastTouchTime = 0;
            return;
        }
    }
}

/// Call IndigoHIDMessageForMouseNSEvent with an already-normalized CGPoint.
///
/// The function reads 4 trailing `double` args (in d0–d3 per the ARM64 ABI)
/// that must be 1.0, or the built touch has no effect — the event "sends"
/// without error but never registers with backboardd. They are declared in the
/// `IndigoMouseFn` typedef and passed as 1.0, 1.0, 1.0, 1.0 below so the
/// compiler supplies them via the normal calling convention. (An earlier
/// version set d0–d3 with inline asm; a refactor removed it as "pointless" and
/// silently broke all touch injection — coordinate mapping still worked, so a
/// dead-center tap test looked fine, but real taps stopped landing.)
///
/// `pt` MUST already be clamped to [0,1] by the caller — handing backboardd an
/// out-of-range coordinate trips an assert and relaunches SpringBoard.
///
/// MUST be called on the main thread — IndigoHIDMessageForMouseNSEvent uses
/// thread-local state to track active touch sequences.
static void* SHCallIndigoMouseFn(IndigoMouseFn fn,
                                  CGPoint *pt,
                                  void *prevMsg,
                                  int nsEventType,
                                  int direction)
{
    return fn(pt, prevMsg, 0x32, nsEventType, direction, 1.0, 1.0, 1.0, 1.0);
}

/// Build an Indigo HID touch message and send it via the HID client.
///
/// udid: simulator UDID (used to look up per-simulator touch state).
/// normX, normY: normalized screen coordinates in [0.0, 1.0].
/// nsEventType: 1=mouseDown, 2=mouseUp, 6=mouseDragged (NSEvent.EventType raw values).
/// direction: 1=down, 2=up, 0=drag.
///
/// Returns 0 on success, negative on failure.
///
/// Called on the main thread (Tauri IPC), which provides the serialization
/// needed for touch sequences (down → drag → up) and satisfies
/// IndigoHIDMessageForMouseNSEvent's main-thread requirement.
int32_t SHSendTouch(id client, void *fnPtr,
                     const char *udid,
                     float normX, float normY,
                     int nsEventType, int direction) {
    if (!client || !fnPtr || !udid) return -1;

    SHTouchState *ts = _touchStateForUDID(udid);

    // IndigoHIDMessageForMouseNSEvent has an internal ~16ms throttle for drag
    // events: if called again too soon it allocates a message, checks the
    // elapsed time, frees the message and returns NULL.  We respect the same
    // interval on our side so we never hit that path.  For drag events that
    // arrive too early we silently drop them (return 0) — the next drag will
    // carry the updated position.
    uint64_t now = mach_absolute_time();
    if (direction == 0 && ts->lastTouchTime != 0) {
        uint64_t elapsed = now - ts->lastTouchTime;
        mach_timebase_info_data_t timebase;
        _ensureTimebase(&timebase);
        uint64_t elapsedNano = elapsed * timebase.numer / timebase.denom;
        if (elapsedNano < INDIGO_MIN_INTERVAL_NS) {
            return 0;  // silently skip — not an error
        }
    }

    IndigoMouseFn fn = (IndigoMouseFn)fnPtr;

    // Clamp to [0,1]. An out-of-range point becomes an off-screen digitizer
    // coordinate, which trips a backboardd assert and relaunches SpringBoard —
    // this is the single most important crash guard on the touch path.
    if (normX < 0.0f) normX = 0.0f; else if (normX > 1.0f) normX = 1.0f;
    if (normY < 0.0f) normY = 0.0f; else if (normY > 1.0f) normY = 1.0f;
    CGPoint pt = { (double)normX, (double)normY };

    // Touch continuity: pass our OWN snapshot of the previous message, never
    // IndigoHID's process-global static buffer. That buffer is overwritten by
    // the next fn() call for THIS or ANY other simulator, so handing it back as
    // prevMsg can splice a different device's touch into this sequence — a
    // stale/mismatched continuity record that wedges SpringBoard. DOWN
    // (direction=1) starts a fresh sequence, so it passes NULL.
    void *prevMsg = (direction == 1) ? NULL : ts->lastIndigoMsg;

    void *msg = SHCallIndigoMouseFn(fn, &pt, prevMsg, nsEventType, direction);
    if (!msg) {
        NSLog(@"[IndigoHID] IndigoHIDMessageForMouseNSEvent returned NULL for "
              @"(%.4f, %.4f) nsEventType=%d direction=%d prevMsg=%p",
              normX, normY, nsEventType, direction, prevMsg);
        return -2;
    }

    ts->lastTouchTime = now;

    // Snapshot the shared static buffer into two independent owned copies: one
    // handed to the HID client for sending (freed by it via freeWhenDone:YES),
    // and one retained as this UDID's continuity record for the next drag/up.
    void *copy = malloc(SH_TOUCH_MSG_SIZE);
    void *owned = malloc(SH_TOUCH_MSG_SIZE);
    if (!copy || !owned) {
        free(copy);
        free(owned);
        NSLog(@"[IndigoHID] touch message allocation failed");
        return -7;
    }
    memcpy(copy, msg, SH_TOUCH_MSG_SIZE);
    memcpy(owned, msg, SH_TOUCH_MSG_SIZE);

    // Replace the retained continuity snapshot, freeing the previous one.
    if (ts->lastIndigoMsg) free(ts->lastIndigoMsg);
    ts->lastIndigoMsg = owned;

    // Capture a pointer to this simulator's invalidation flag so the async
    // completion marks the RIGHT simulator as invalid (not a different one).
    _Atomic(bool) *invalidFlag = &ts->invalid;

    SEL sel = NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:");

    if (direction == 1) {
        // DOWN: send synchronously so we detect machPortInvalid immediately.
        // The caller (Swift) can then recreate the client and retry.
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        __block NSError *sendError = nil;
        dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
        void (^completion)(NSError *) = ^(NSError *error) {
            sendError = error;
            dispatch_semaphore_signal(sem);
        };

        ((void (*)(id, SEL, void *, BOOL, dispatch_queue_t, void(^)(NSError *)))objc_msgSend)(
            client, sel, copy, YES, queue, completion);

        dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC));

        if (sendError) {
            NSLog(@"[IndigoHID] DOWN send error: %@", sendError);
            atomic_store(invalidFlag, true);
            free(ts->lastIndigoMsg);
            ts->lastIndigoMsg = NULL;
            ts->lastTouchTime = 0;
            return -6;  // caller will recreate client and retry
        }
    } else {
        // DRAG/UP: send asynchronously — latency matters more here.
        // Capture UDID as NSString — the C pointer won't survive the async callback.
        NSString *udidNS = [[NSString alloc] initWithUTF8String:udid];
        dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
        void (^completion)(NSError *) = ^(NSError *error) {
            if (error) {
                NSLog(@"[IndigoHID] send error: %@", error);
                atomic_store(invalidFlag, true);
                // Proactively clear touch state so the next DOWN starts clean
                dispatch_async(dispatch_get_main_queue(), ^{
                    SHClearTouchStateForUDID(udidNS.UTF8String);
                });
            }
        };

        ((void (*)(id, SEL, void *, BOOL, dispatch_queue_t, void(^)(NSError *)))objc_msgSend)(
            client, sel, copy, YES, queue, completion);
    }

    // Free the owned continuity snapshot on mouseUp — sequence is complete.
    if (direction == 2) {
        free(ts->lastIndigoMsg);
        ts->lastIndigoMsg = NULL;
        ts->lastTouchTime = 0;
    }

    return 0;
}

// ---------------------------------------------------------------------------
// MARK: - HID keyboard injection
// ---------------------------------------------------------------------------

// Function pointer type for IndigoHIDMessageForKeyboardNSEvent.
// Takes NSEvent*, returns pointer to 192-byte static buffer.
typedef void* (*IndigoKeyboardFn)(id);

/// Build an Indigo HID keyboard message and send it via the HID client.
///
/// keyCode: macOS virtual key code (e.g. 126=Up, 36=Return).
/// modifierFlags: NSEvent modifier flags (e.g. NSEventModifierFlagCommand).
/// isDown: YES for key-down, NO for key-up.
///
/// Returns 0 on success, negative on failure.
int32_t SHSendKeyboard(id client, void *fnPtr,
                        const char *udid,
                        uint16_t keyCode, uint64_t modifierFlags,
                        BOOL isDown) {
    if (!client || !fnPtr || !udid) return -1;

    SHTouchState *ts = _touchStateForUDID(udid);

    IndigoKeyboardFn fn = (IndigoKeyboardFn)fnPtr;

    NSEventType eventType = isDown ? NSEventTypeKeyDown : NSEventTypeKeyUp;
    NSPoint location = NSMakePoint(0, 0);
    NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970];
    NSString *characters = @"";
    NSString *charactersIgnoringModifiers = @"";

    NSEvent *event = [NSEvent keyEventWithType:eventType
                                       location:location
                                  modifierFlags:modifierFlags
                                      timestamp:timestamp
                                   windowNumber:0
                                        context:nil
                                     characters:characters
                    charactersIgnoringModifiers:charactersIgnoringModifiers
                                      isARepeat:NO
                                        keyCode:keyCode];

    if (!event) {
        NSLog(@"[IndigoHID] Failed to create NSEvent for keyCode=%u isDown=%d", keyCode, isDown);
        return -2;
    }

    void *msg = fn(event);
    if (!msg) {
        NSLog(@"[IndigoHID] IndigoHIDMessageForKeyboardNSEvent returned NULL for keyCode=%u", keyCode);
        return -3;
    }

    // Copy the buffer for sending — the HID client frees it via freeWhenDone.
    void *copy = malloc(SH_KEYBOARD_MSG_SIZE);
    if (!copy) {
        NSLog(@"[IndigoHID] keyboard message allocation failed");
        return -5;
    }
    memcpy(copy, msg, SH_KEYBOARD_MSG_SIZE);

    _Atomic(bool) *invalidFlag = &ts->invalid;

    SEL sel = NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:");
    dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    void (^completion)(NSError *) = ^(NSError *error) {
        if (error) {
            NSLog(@"[IndigoHID] keyboard send error: %@", error);
            atomic_store(invalidFlag, true);
        }
    };

    ((void (*)(id, SEL, void *, BOOL, dispatch_queue_t, void(^)(NSError *)))objc_msgSend)(
        client, sel, copy, YES, queue, completion);

    return 0;
}

// ---------------------------------------------------------------------------
// MARK: - HID hardware button injection
// ---------------------------------------------------------------------------

// IndigoHIDMessageForButton(IndigoHIDButtonKeyCode, IndigoHIDButtonOp,
//   IndigoHIDTarget) -> IndigoHIDMessage*  (per SimulatorKit's own assert
// string). It calloc's a fresh 192-byte message (SH_KEYBOARD_MSG_SIZE) — the
// caller OWNS it and must free it, unlike the mouse/keyboard variants which
// return a shared static buffer. Op values (from the disassembly): down=1, up=2.
// The `target` MUST be a valid IndigoHIDTarget (SimDeviceScreen.buttonTarget,
// 21 or 51 by device family) — an invalid target aborts backboardd in the
// guest's -[SimHIDVirtualServiceManager serviceForIndigoHIDData:].
typedef void* (*IndigoButtonFn)(uint32_t, uint32_t, uint32_t);

/// Build a real hardware-button HID message (Home, Lock, Volume, …) and send
/// it via the HID client. Sturdier than faking a keyboard chord: it doesn't
/// depend on a focused keyboard responder and can't misfire as text.
///
/// Returns 0 on success, negative on failure.
int32_t SHSendButton(id client, void *fnPtr,
                     const char *udid,
                     uint32_t keyCode, uint32_t op, uint32_t target) {
    if (!client || !fnPtr || !udid) return -1;

    IndigoButtonFn fn = (IndigoButtonFn)fnPtr;
    void *msg = fn(keyCode, op, target);
    if (!msg) {
        NSLog(@"[IndigoHID] IndigoHIDMessageForButton returned NULL for "
              @"keyCode=%u op=%u", keyCode, op);
        return -3;
    }

    // Copy into our own buffer for the (async) send, which the client frees via
    // freeWhenDone:YES; then free the calloc'd message the function handed us.
    void *copy = malloc(SH_KEYBOARD_MSG_SIZE);
    if (!copy) {
        free(msg);
        NSLog(@"[IndigoHID] button message allocation failed");
        return -5;
    }
    memcpy(copy, msg, SH_KEYBOARD_MSG_SIZE);
    free(msg);

    _Atomic(bool) *invalidFlag = NULL;
    for (int i = 0; i < g_touchStateCount; i++) {
        if (strcmp(g_touchStates[i].udid, udid) == 0) {
            invalidFlag = &g_touchStates[i].invalid;
            break;
        }
    }

    SEL sel = NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:");
    dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    void (^completion)(NSError *) = ^(NSError *error) {
        if (error) {
            NSLog(@"[IndigoHID] button send error: %@", error);
            if (invalidFlag) atomic_store(invalidFlag, true);
        }
    };

    ((void (*)(id, SEL, void *, BOOL, dispatch_queue_t, void(^)(NSError *)))objc_msgSend)(
        client, sel, copy, YES, queue, completion);

    return 0;
}

/// Enable hardware-keyboard mode on the SimDevice so physical key events are
/// routed to the focused text field. Called once per capture session; without
/// it, text entry via the HID keyboard path is flaky.
void SHEnableHardwareKeyboard(id device) {
    if (!device) return;
    SEL sel = NSSelectorFromString(@"setHardwareKeyboardEnabled:keyboardType:error:");
    if (![device respondsToSelector:sel]) {
        NSLog(@"[IndigoHID] setHardwareKeyboardEnabled:keyboardType:error: unavailable");
        return;
    }
    NSError *err = nil;
    // keyboardType 0 = default. Pass the type as a full 64-bit register so the
    // value is 0 regardless of the parameter's real width.
    BOOL ok = ((BOOL (*)(id, SEL, BOOL, unsigned long long, NSError **))objc_msgSend)(
        device, sel, YES, 0ULL, &err);
    if (!ok || err) {
        NSLog(@"[IndigoHID] setHardwareKeyboardEnabled failed: %@", err);
    } else {
        NSLog(@"[IndigoHID] hardware keyboard enabled");
    }
}

// ---------------------------------------------------------------------------
// MARK: - Framebuffer capture via SimDeviceIOClient + IOSurface
// ---------------------------------------------------------------------------

typedef void (*SHFrameCallback)(const uint8_t *, size_t);

// Forward declaration
void SHStopFramebuffer(void);

static dispatch_source_t g_captureTimer = NULL;
static SHFrameCallback g_frameCallback = NULL;
static id g_ioClient = nil;
static id g_displayDescriptor = nil;   // SimDisplayIOSurfaceRenderable proxy
static id g_captureDevice = nil;       // SimDevice retained for IOClient recreation

// ---------------------------------------------------------------------------
// MARK: - VideoToolbox H.264 encoder
//
// Replaces the old per-frame CPU JPEG path: the IOSurface is wrapped
// zero-copy in a CVPixelBuffer and fed to a VTCompressionSession. The output
// callback converts the AVCC (length-prefixed) NAL units to an Annex B
// elementary stream (with SPS/PPS on keyframes) and emits it via
// g_frameCallback — matching what the Node-side H264AccessUnitParser expects.
// ---------------------------------------------------------------------------

static VTCompressionSessionRef g_vtSession = NULL;
static int32_t g_vtWidth = 0;   // source (IOSurface) dims — for change detection
static int32_t g_vtHeight = 0;
static int64_t g_frameIndex = 0;
static _Atomic(bool) g_forceKeyframe = false;

static const uint8_t kAnnexBStartCode[4] = {0x00, 0x00, 0x00, 0x01};

// Cap the longest ENCODED dimension for performance (consistent with the
// Android capture path's maxSize default). The framebuffer is captured at
// native resolution and VideoToolbox scales it down to fit; 0 disables the
// cap. 1920 keeps Retina mirrors crisp while roughly halving the encode cost
// of the largest devices.
static int32_t g_maxEncodeDim = 1920;

/// Compute the (aspect-preserving, even) H.264 encode dimensions for a source
/// framebuffer, applying the resolution cap.
static void _encodeDims(int32_t sw, int32_t sh, int32_t *ew, int32_t *eh) {
    int32_t longest = sw > sh ? sw : sh;
    if (g_maxEncodeDim > 0 && longest > g_maxEncodeDim) {
        double scale = (double)g_maxEncodeDim / (double)longest;
        sw = (int32_t)(sw * scale);
        sh = (int32_t)(sh * scale);
    }
    sw &= ~1;  // H.264 requires even dimensions
    sh &= ~1;
    *ew = sw < 2 ? 2 : sw;
    *eh = sh < 2 ? 2 : sh;
}

/// VT output callback — runs on a VideoToolbox-managed thread. Serializes the
/// compressed access unit as Annex B and hands it to the frame callback.
static void _vtOutputCallback(void *outputCallbackRefCon,
                              void *sourceFrameRefCon,
                              OSStatus status,
                              VTEncodeInfoFlags infoFlags,
                              CMSampleBufferRef sampleBuffer) {
    SHFrameCallback cb = g_frameCallback;
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

    // Prepend SPS/PPS (as Annex B) ahead of every keyframe so late joiners can
    // configure their decoder.
    if (isKeyframe) {
        CMFormatDescriptionRef fmt = CMSampleBufferGetFormatDescription(sampleBuffer);
        if (fmt) {
            size_t paramCount = 0;
            if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
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
    }

    // Convert the AVCC block buffer (4-byte length prefixes) to Annex B.
    CMBlockBufferRef bb = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (bb) {
        size_t totalLen = 0;
        char *dataPtr = NULL;
        if (CMBlockBufferGetDataPointer(bb, 0, NULL, &totalLen, &dataPtr) == noErr && dataPtr) {
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
    }

    if (out.length > 0) {
        cb((const uint8_t *)out.bytes, out.length);
    }
}

/// Tear down the compression session and reset encoder state.
static void _teardownVTSession(void) {
    if (g_vtSession) {
        VTCompressionSessionCompleteFrames(g_vtSession, kCMTimeInvalid);
        VTCompressionSessionInvalidate(g_vtSession);
        CFRelease(g_vtSession);
        g_vtSession = NULL;
    }
    g_vtWidth = 0;
    g_vtHeight = 0;
    g_frameIndex = 0;
}

/// Create the compression session lazily, recreating it if the surface
/// dimensions changed. Returns NO on failure.
static BOOL _ensureVTSession(int32_t w, int32_t h) {
    if (g_vtSession && g_vtWidth == w && g_vtHeight == h) return YES;
    _teardownVTSession();

    int32_t ew, eh;
    _encodeDims(w, h, &ew, &eh);

    OSStatus st = VTCompressionSessionCreate(
        kCFAllocatorDefault, ew, eh, kCMVideoCodecType_H264,
        NULL, NULL, NULL, _vtOutputCallback, NULL, &g_vtSession);
    if (st != noErr || !g_vtSession) {
        NSLog(@"[Framebuffer] VTCompressionSessionCreate failed: %d", (int)st);
        g_vtSession = NULL;
        return NO;
    }

    VTSessionSetProperty(g_vtSession, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(g_vtSession, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
    VTSessionSetProperty(g_vtSession, kVTCompressionPropertyKey_ProfileLevel,
                         kVTProfileLevel_H264_Main_AutoLevel);

    // Quality-driven VBR instead of a fixed average bitrate: crisp text,
    // near-zero bytes on static screens, and the bitrate rises only under
    // motion. No bitrate cap — the transport is localhost.
    // Kept below 1.0: at 1.0 VideoToolbox preserves the BGRA source's full
    // chroma and emits High 4:4:4 (profile 244), which WebCodecs can't decode;
    // 0.8 keeps it 4:2:0 / decodable while still visually lossless for UI.
    float quality = 0.8f;
    CFNumberRef qNum = CFNumberCreate(NULL, kCFNumberFloat32Type, &quality);
    VTSessionSetProperty(g_vtSession, kVTCompressionPropertyKey_Quality, qNum);
    CFRelease(qNum);

    // Keyframe every 1s (time-based) for fast recovery and late-joiner
    // startup, independent of frame rate.
    double kfDur = 1.0;
    CFNumberRef kfNum = CFNumberCreate(NULL, kCFNumberFloat64Type, &kfDur);
    VTSessionSetProperty(g_vtSession, kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, kfNum);
    CFRelease(kfNum);

    int32_t fps = 30;
    CFNumberRef fpsNum = CFNumberCreate(NULL, kCFNumberSInt32Type, &fps);
    VTSessionSetProperty(g_vtSession, kVTCompressionPropertyKey_ExpectedFrameRate, fpsNum);
    CFRelease(fpsNum);

    // When encoding below native resolution, let VideoToolbox scale the source
    // pixel buffer down (aspect preserved by _encodeDims, so Trim never crops).
    if (ew != w || eh != h) {
        const void *ks[] = { kVTPixelTransferPropertyKey_ScalingMode };
        const void *vs[] = { kVTScalingMode_Trim };
        CFDictionaryRef xfer = CFDictionaryCreate(NULL, ks, vs, 1,
            &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        VTSessionSetProperty(g_vtSession, kVTCompressionPropertyKey_PixelTransferProperties, xfer);
        CFRelease(xfer);
    }

    VTCompressionSessionPrepareToEncodeFrames(g_vtSession);

    g_vtWidth = w;
    g_vtHeight = h;
    g_frameIndex = 0;
    NSLog(@"[Framebuffer] VTCompressionSession source %dx%d → encode %dx%d (quality VBR)",
          w, h, ew, eh);
    return YES;
}

/// Force the next encoded frame to be a keyframe. Called when a new streaming
/// client connects so it gets a decodable stream (SPS/PPS + IDR) promptly.
void SHRequestKeyframe(void) {
    atomic_store(&g_forceKeyframe, true);
}

/// Read a descriptor's framebufferSurface, or NULL.
static IOSurfaceRef _surfaceForDescriptor(id desc) {
    @try {
        return (__bridge IOSurfaceRef)((id (*)(id, SEL))objc_msgSend)(
            desc, NSSelectorFromString(@"framebufferSurface"));
    } @catch (NSException *e) {
        return NULL;
    }
}

/// Pick which display to capture when a device exposes more than one.
///
/// A folded iPhone Duo keeps a surface on both panels, but only the panel that
/// is actually lit keeps redrawing — the dark one's IOSurface seed is frozen.
/// Sample the seeds and take the panel that moves, so we stream the cover
/// screen while closed and the inner screen once unfolded. Single-display
/// devices skip the sampling entirely.
static id _pickLiveDisplay(NSArray *candidates) {
    if (candidates.count <= 1) {
        return candidates.firstObject;
    }

    NSMutableArray<NSNumber *> *seeds = [NSMutableArray array];
    for (id desc in candidates) {
        IOSurfaceRef s = _surfaceForDescriptor(desc);
        [seeds addObject:@(s ? IOSurfaceGetSeed(s) : 0)];
    }

    // ~360ms is enough for a lit panel to redraw at least once, and is only
    // ever paid on a multi-display device at capture start.
    for (int round = 0; round < 6; round++) {
        usleep(60000);
        for (NSUInteger i = 0; i < candidates.count; i++) {
            IOSurfaceRef s = _surfaceForDescriptor(candidates[i]);
            if (s && IOSurfaceGetSeed(s) != seeds[i].unsignedIntValue) {
                NSLog(@"[Framebuffer] %lu displays, capturing the live one (#%lu)",
                      (unsigned long)candidates.count, (unsigned long)i);
                return candidates[i];
            }
        }
    }

    // Every panel is static (asleep, or a perfectly still screen) — the first
    // one is as good a guess as any.
    NSLog(@"[Framebuffer] %lu displays, none redrawing — capturing the first",
          (unsigned long)candidates.count);
    return candidates.firstObject;
}

/// (Re)create the SimDeviceIOClient and find the display descriptor.
/// Returns YES if g_displayDescriptor is ready, NO on failure.
static BOOL _rebuildIOClient(void) {
    g_displayDescriptor = nil;
    g_ioClient = nil;

    if (!g_captureDevice) return NO;

    Class ioClientClass = NSClassFromString(@"SimDeviceIOClient");
    if (!ioClientClass) return NO;

    SEL initSel = NSSelectorFromString(@"initWithDevice:errorQueue:errorHandler:");
    dispatch_queue_t errQueue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    void (^errorHandler)(NSError *) = ^(NSError *err) {
        NSLog(@"[Framebuffer] IOClient error: %@", err);
    };

    g_ioClient = ((id (*)(id, SEL, id, dispatch_queue_t, void(^)(NSError *)))objc_msgSend)(
        [ioClientClass alloc], initSel, g_captureDevice, errQueue, errorHandler);

    if (!g_ioClient) return NO;

    // Find the framebuffer display port whose descriptor has a live IOSurface.
    // There can be multiple "com.apple.framebuffer.display" ports — only the one
    // backed by SimScreen (not the bare descriptor) provides the surface.
    NSArray *ports = [g_ioClient valueForKey:@"ioPorts"];
    NSMutableArray *candidates = [NSMutableArray array];  // descriptors with a surface
    id fallbackDescriptor = nil;                          // surface may appear later
    for (id port in ports) {
        @try {
            id portId = ((id (*)(id, SEL))objc_msgSend)(
                port, NSSelectorFromString(@"portIdentifier"));
            if (![portId isEqualToString:@"com.apple.framebuffer.display"]) {
                continue;
            }
            id desc = ((id (*)(id, SEL))objc_msgSend)(
                port, NSSelectorFromString(@"descriptor"));
            if (!desc) continue;

            // Check if this descriptor actually has a framebufferSurface
            IOSurfaceRef surface = (__bridge IOSurfaceRef)((id (*)(id, SEL))objc_msgSend)(
                desc, NSSelectorFromString(@"framebufferSurface"));
            if (surface) {
                [candidates addObject:desc];
            } else if (!fallbackDescriptor) {
                fallbackDescriptor = desc;
            }
        } @catch (NSException *e) {
            continue;
        }
    }

    g_displayDescriptor = _pickLiveDisplay(candidates) ?: fallbackDescriptor;

    if (!g_displayDescriptor) {
        NSLog(@"[Framebuffer] No com.apple.framebuffer.display port found (%lu ports total)",
              (unsigned long)ports.count);
        g_ioClient = nil;
        return NO;
    }

    return YES;
}

int32_t SHStartFramebuffer(id device, SHFrameCallback callback) {
    SHStopFramebuffer();

    if (!device || !callback) return -1;
    g_frameCallback = callback;
    g_captureDevice = device;

    if (!_rebuildIOClient()) {
        NSLog(@"[Framebuffer] Initial IOClient setup failed");
        g_captureDevice = nil;
        return -3;
    }

    // Check if surface is already available
    @try {
        IOSurfaceRef surface = (__bridge IOSurfaceRef)((id (*)(id, SEL))objc_msgSend)(
            g_displayDescriptor, NSSelectorFromString(@"framebufferSurface"));
        if (surface) {
            NSLog(@"[Framebuffer] Capturing %zux%zu BGRA framebuffer",
                  IOSurfaceGetWidth(surface), IOSurfaceGetHeight(surface));
        } else {
            NSLog(@"[Framebuffer] framebufferSurface not yet available — will retry IOClient");
        }
    } @catch (NSException *e) {
        NSLog(@"[Framebuffer] framebufferSurface threw: %@ — will retry", e.reason);
    }

    // --- Start timer for H.264 encoding at ~30fps ---
    // If framebufferSurface stays nil, the timer will periodically rebuild the
    // IOClient — the surface port is bound at creation time, so a stale client
    // created before Simulator.app switched to this device will never get one.
    dispatch_queue_t timerQueue = dispatch_queue_create(
        "com.argus.framebuffer", DISPATCH_QUEUE_SERIAL);
    g_captureTimer = dispatch_source_create(
        DISPATCH_SOURCE_TYPE_TIMER, 0, 0, timerQueue);
    dispatch_source_set_timer(g_captureTimer,
        DISPATCH_TIME_NOW,
        33 * NSEC_PER_MSEC,   // ~30fps
        5 * NSEC_PER_MSEC);   // leeway

    __block uint32_t nilSurfaceCount = 0;

    dispatch_source_set_event_handler(g_captureTimer, ^{
        if (!g_frameCallback || !g_captureDevice) return;

        // If we lost the descriptor (rebuild failed), try again periodically
        if (!g_displayDescriptor) {
            nilSurfaceCount++;
            // Retry every ~330ms (10 timer ticks at 33ms)
            if (nilSurfaceCount % 10 == 0) {
                NSLog(@"[Framebuffer] Retrying IOClient rebuild...");
                _rebuildIOClient();
            }
            return;
        }

        IOSurfaceRef surface = NULL;
        @try {
            surface = (__bridge IOSurfaceRef)((id (*)(id, SEL))objc_msgSend)(
                g_displayDescriptor, NSSelectorFromString(@"framebufferSurface"));
        } @catch (NSException *e) {
            return;
        }

        if (!surface) {
            nilSurfaceCount++;
            // After ~330ms of nil surfaces, rebuild the IOClient — the surface
            // port is established at creation time so a client created before
            // activate_simulator_window took effect will never get one.
            if (nilSurfaceCount % 10 == 0) {
                NSLog(@"[Framebuffer] framebufferSurface still nil after %u ticks — rebuilding IOClient",
                      nilSurfaceCount);
                _rebuildIOClient();
            }
            return;
        }

        // Got a valid surface — reset nil counter
        if (nilSurfaceCount > 0) {
            NSLog(@"[Framebuffer] Capturing %zux%zu BGRA framebuffer (after %u nil ticks)",
                  IOSurfaceGetWidth(surface), IOSurfaceGetHeight(surface), nilSurfaceCount);
            nilSurfaceCount = 0;
        }

        int32_t w = (int32_t)IOSurfaceGetWidth(surface);
        int32_t h = (int32_t)IOSurfaceGetHeight(surface);

        if (!_ensureVTSession(w, h)) return;

        // Wrap the IOSurface (32BGRA) zero-copy in a CVPixelBuffer and encode.
        CVPixelBufferRef pb = NULL;
        CVReturn cvret = CVPixelBufferCreateWithIOSurface(NULL, surface, NULL, &pb);
        if (cvret != kCVReturnSuccess || !pb) {
            if (pb) CVPixelBufferRelease(pb);
            return;
        }

        CMTime pts = CMTimeMake(g_frameIndex++, 30);

        CFDictionaryRef frameProps = NULL;
        if (atomic_exchange(&g_forceKeyframe, false)) {
            const void *keys[1] = { kVTEncodeFrameOptionKey_ForceKeyFrame };
            const void *vals[1] = { kCFBooleanTrue };
            frameProps = CFDictionaryCreate(NULL, keys, vals, 1,
                &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        }

        VTCompressionSessionEncodeFrame(g_vtSession, pb, pts, kCMTimeInvalid,
                                        frameProps, NULL, NULL);

        if (frameProps) CFRelease(frameProps);
        CVPixelBufferRelease(pb);
    });

    dispatch_resume(g_captureTimer);

    NSLog(@"[Framebuffer] Capture started at 30fps");
    return 0;
}

void SHStopFramebuffer(void) {
    if (g_captureTimer) {
        dispatch_source_cancel(g_captureTimer);
        g_captureTimer = NULL;
    }

    _teardownVTSession();
    atomic_store(&g_forceKeyframe, false);

    g_displayDescriptor = nil;
    g_ioClient = nil;
    g_captureDevice = nil;
    g_frameCallback = NULL;
}
