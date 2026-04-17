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

// ---------------------------------------------------------------------------
// MARK: - HID touch injection
// ---------------------------------------------------------------------------

// Function pointer type for IndigoHIDMessageForMouseNSEvent.
// Args: point, prevMsg, 0x32, nsEventType, direction → 320-byte static buffer.
// prevMsg: NULL for mouseDown (new touch), previous message for drag/up (continuity).
typedef void* (*IndigoMouseFn)(CGPoint*, void*, int, int, int);

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
    // Evict oldest (slot 0) and shift — unlikely to hit with ≤8 simulators
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
            g_touchStates[i].lastIndigoMsg = NULL;
            g_touchStates[i].lastTouchTime = 0;
            return;
        }
    }
}

/// Call IndigoHIDMessageForMouseNSEvent with SIMD registers d0-d3 set to 1.0.
///
/// The function internally divides the input coordinates by values in d0-d3
/// (normally loaded with the screen pixel dimensions). By forcing them to 1.0,
/// the division becomes a no-op and we can pass normalized [0,1] ratios directly.
///
/// MUST be called on the main thread — IndigoHIDMessageForMouseNSEvent uses
/// thread-local state to track active touch sequences.
static void* SHCallIndigoMouseFn(IndigoMouseFn fn,
                                  CGPoint *pt,
                                  void *prevMsg,
                                  int nsEventType,
                                  int direction)
{
#if defined(__aarch64__)
    double one = 1.0;
    __asm__ volatile (
        "ldr d0, %[one]\n"
        "ldr d1, %[one]\n"
        "ldr d2, %[one]\n"
        "ldr d3, %[one]\n"
        : : [one] "m" (one)
        : "d0", "d1", "d2", "d3"
    );
#endif
    return fn(pt, prevMsg, 0x32, nsEventType, direction);
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
    CGPoint pt = { (double)normX, (double)normY };

    // mouseDown (direction=1) starts a new touch — pass NULL.
    // mouseDragged/mouseUp pass the previous message for touch continuity.
    void *prevMsg = (direction == 1) ? NULL : ts->lastIndigoMsg;

    void *msg = SHCallIndigoMouseFn(fn, &pt, prevMsg, nsEventType, direction);
    if (!msg) {
        NSLog(@"[IndigoHID] IndigoHIDMessageForMouseNSEvent returned NULL for "
              @"(%.4f, %.4f) nsEventType=%d direction=%d prevMsg=%p",
              normX, normY, nsEventType, direction, prevMsg);
        return -2;
    }

    ts->lastTouchTime = now;
    ts->lastIndigoMsg = msg;

    // Copy the buffer for sending — the HID client frees it asynchronously
    // via freeWhenDone:YES, so we can't hand over the internal buffer directly.
    void *copy = malloc(320);
    memcpy(copy, msg, 320);

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

    // Clear saved pointer on mouseUp — touch sequence is complete.
    // Don't free: the buffer is owned by IndigoHID internals.
    if (direction == 2) {
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

    // Copy the buffer — 192 bytes (0xc0) per disassembly.
    void *copy = malloc(192);
    memcpy(copy, msg, 192);

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
    g_displayDescriptor = nil;
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
                g_displayDescriptor = desc;
                break;
            }
            // Keep this descriptor as a fallback (surface may appear later)
            if (!g_displayDescriptor) {
                g_displayDescriptor = desc;
            }
        } @catch (NSException *e) {
            continue;
        }
    }

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

    // --- Start timer for JPEG encoding at ~30fps ---
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

        size_t w = IOSurfaceGetWidth(surface);
        size_t h = IOSurfaceGetHeight(surface);
        size_t bpr = IOSurfaceGetBytesPerRow(surface);

        IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL);

        void *base = IOSurfaceGetBaseAddress(surface);
        CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();

        // BGRA pixel format
        CGContextRef ctx = CGBitmapContextCreate(
            base, w, h, 8, bpr, cs,
            kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);
        CGColorSpaceRelease(cs);

        if (ctx) {
            CGImageRef image = CGBitmapContextCreateImage(ctx);
            CGContextRelease(ctx);

            if (image) {
                NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
                CGImageRelease(image);

                NSDictionary *props = @{NSImageCompressionFactor: @0.7};
                NSData *jpeg = [rep representationUsingType:NSBitmapImageFileTypeJPEG
                                                properties:props];
                if (jpeg && g_frameCallback) {
                    g_frameCallback(jpeg.bytes, jpeg.length);
                }
            }
        }

        IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
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

    g_displayDescriptor = nil;
    g_ioClient = nil;
    g_captureDevice = nil;
    g_frameCallback = NULL;
}
