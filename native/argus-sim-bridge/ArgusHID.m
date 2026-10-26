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
#import "ArgusEncoder.h"

// ---------------------------------------------------------------------------
// MARK: - HID touch injection
// ---------------------------------------------------------------------------

// Function pointer type for IndigoHIDMessageForMouseNSEvent, whose real
// signature (per SimulatorKit's own assert string) is:
//   (CGPoint *point, CGPoint *prevPoint, IndigoHIDTarget, NSEventType,
//    NSSize scale, IndigoHIDEdge)
// It returns a freshly calloc'd message the caller owns: a 0x20 header plus one
// 0xa0 record per touch, so 0x160 for the usual two and 0x200 when prevPoint
// adds a third.
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
        s->lastTouchTime = 0;
        atomic_store(&s->invalid, false);
        return s;
    }
    // Evict oldest (slot 0) and shift — unlikely to hit with ≤8 simulators.
    for (int i = 1; i < MAX_TOUCH_STATES; i++) {
        g_touchStates[i - 1] = g_touchStates[i];
    }
    SHTouchState *s = &g_touchStates[MAX_TOUCH_STATES - 1];
    strlcpy(s->udid, udid, sizeof(s->udid));
    s->lastTouchTime = 0;
    atomic_store(&s->invalid, false);
    return s;
}

// Minimum nanoseconds between IndigoHIDMessageForMouseNSEvent calls.
// The function's internal threshold is ~16ms.  We use 17ms for safety.
#define INDIGO_MIN_INTERVAL_NS 17000000ULL

// The keyboard/button Indigo builders calloc a fixed 0xc0-byte message (a 0x20
// header plus one 0xa0 record). The touch builder's size varies with its record
// count, so that path hands the returned buffer straight to the HID client
// instead of copying it into a fixed-size block.
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
/// direction: 1=down, 2=up, 0=drag. Also doubles as the builder's IndigoHIDEdge
///   argument; passing 0 for every phase stops drags registering, so the
///   mapping stays as-is.
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

    // prevPoint stays NULL: a non-NULL argument makes IndigoHID append a second
    // touch record built from the previous point, which is not what a
    // single-finger drag wants. (The old code passed the previous *message*
    // here, where the API wants a CGPoint *.)
    void *msg = SHCallIndigoMouseFn(fn, &pt, NULL, nsEventType, direction);
    if (!msg) {
        NSLog(@"[IndigoHID] IndigoHIDMessageForMouseNSEvent returned NULL for "
              @"(%.4f, %.4f) nsEventType=%d direction=%d",
              normX, normY, nsEventType, direction);
        return -2;
    }

    ts->lastTouchTime = now;

    // The builder calloc's a fresh message per call whose size varies with the
    // record count, so hand that buffer straight to the client (it frees it via
    // freeWhenDone:YES). Copying it into a fixed-size block truncated every
    // message mid-record.
    void *copy = msg;

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

    // The sequence is complete on mouseUp — let the next DOWN start unthrottled.
    if (direction == 2) {
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

// IndigoHIDMessageForHIDArbitrary(IndigoHIDTarget, uint32_t usagePage,
//   uint32_t usage, IndigoHIDButtonOp) -> IndigoHIDMessage*  (per SimulatorKit's
// own assert string). This is the general path SimDisplayChromeView falls back
// to for every usage it doesn't special-case, and unlike the keyboard variants
// it carries the target — which is what makes it reach the tvOS focus engine.
// Caller owns the returned message, same as IndigoHIDMessageForButton.
typedef void* (*IndigoArbitraryFn)(uint32_t, uint32_t, uint32_t, uint32_t);

/// Send a raw HID usage-page/usage pair (e.g. Consumer 0x0C / Menu Right 0x45)
/// to a simulator. tvOS only acts on the remote through this path; emulated
/// keyboard key codes are ignored outright.
///
/// Returns 0 on success, negative on failure.
int32_t SHSendHIDUsage(id client, void *fnPtr,
                       const char *udid,
                       uint32_t target, uint32_t usagePage,
                       uint32_t usage, uint32_t op) {
    if (!client || !fnPtr || !udid) return -1;

    IndigoArbitraryFn fn = (IndigoArbitraryFn)fnPtr;
    void *msg = fn(target, usagePage, usage, op);
    if (!msg) {
        NSLog(@"[IndigoHID] IndigoHIDMessageForHIDArbitrary returned NULL for "
              @"page=0x%x usage=0x%x op=%u", usagePage, usage, op);
        return -3;
    }

    void *copy = malloc(SH_KEYBOARD_MSG_SIZE);
    if (!copy) {
        free(msg);
        NSLog(@"[IndigoHID] HID usage message allocation failed");
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
            NSLog(@"[IndigoHID] HID usage send error: %@", error);
            if (invalidFlag) atomic_store(invalidFlag, true);
        }
    };

    ((void (*)(id, SEL, void *, BOOL, dispatch_queue_t, void(^)(NSError *)))objc_msgSend)(
        client, sel, copy, YES, queue, completion);

    return 0;
}

/// Read the device's product family id (3 = Apple TV) off its SimDeviceType.
/// Returns 0 when it can't be determined.
uint32_t SHProductFamilyID(id device) {
    if (!device) return 0;
    @try {
        id type = ((id (*)(id, SEL))objc_msgSend)(
            device, NSSelectorFromString(@"deviceType"));
        if (!type) return 0;
        SEL sel = NSSelectorFromString(@"productFamilyID");
        if (![type respondsToSelector:sel]) return 0;

        return (uint32_t)((unsigned long long (*)(id, SEL))objc_msgSend)(type, sel);
    } @catch (NSException *e) {
        return 0;
    }
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

typedef SHEncodedCallback SHFrameCallback;

// Forward declaration
void SHStopFramebuffer(void);

static dispatch_source_t g_captureTimer = NULL;
static SHFrameCallback g_frameCallback = NULL;
static id g_ioClient = nil;
static id g_displayDescriptor = nil;   // SimDisplayIOSurfaceRenderable proxy
static id g_captureDevice = nil;       // SimDevice retained for IOClient recreation

/// Every framebuffer descriptor that had a surface when the client was built.
/// A foldable lights a different panel as the hinge moves, so the live one is
/// re-picked from this list rather than pinned at capture start.
static NSArray *g_displayCandidates = nil;

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
/// Whether a panel is showing nothing. A foldable keeps every panel powered and
/// surfaced even when only one is lit, so `powerState` cannot tell them apart —
/// but the one that is folded away is black, and a sparse sample finds that for
/// far less than the cost of reading the whole buffer.
static BOOL _surfaceIsDark(IOSurfaceRef surface) {
    if (!surface) return YES;
    if (IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL) != kIOReturnSuccess) {
        return NO;  // Can't tell — assume lit rather than skip a good panel.
    }
    const uint8_t *base = IOSurfaceGetBaseAddress(surface);
    size_t stride = IOSurfaceGetBytesPerRow(surface);
    size_t w = IOSurfaceGetWidth(surface), h = IOSurfaceGetHeight(surface);
    BOOL dark = YES;
    if (base && w && h) {
        const int kSteps = 16;
        for (int gy = 0; gy < kSteps && dark; gy++) {
            const uint8_t *row = base + (h * gy / kSteps) * stride;
            for (int gx = 0; gx < kSteps; gx++) {
                const uint8_t *px = row + (w * gx / kSteps) * 4;
                // BGRA; anything clearly above black counts as lit.
                if (px[0] > 12 || px[1] > 12 || px[2] > 12) {
                    dark = NO;
                    break;
                }
            }
        }
    }
    IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);

    return dark;
}

static id _pickLiveDisplay(NSArray *candidates) {
    if (candidates.count <= 1) {
        return candidates.firstObject;
    }

    // A single lit panel is the answer outright — no need to watch for redraws,
    // which a still screen never produces.
    NSMutableArray *lit = [NSMutableArray array];
    for (id desc in candidates) {
        if (!_surfaceIsDark(_surfaceForDescriptor(desc))) {
            [lit addObject:desc];
        }
    }
    if (lit.count == 1) {
        NSLog(@"[Framebuffer] %lu displays, one lit — capturing it",
              (unsigned long)candidates.count);
        return lit.firstObject;
    }
    if (lit.count > 1) {
        candidates = lit;
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

/// Ticks the current panel may go without redrawing before we start looking for
/// a livelier one. ~1s at 30fps: long enough that a still screen is not mistaken
/// for a dark one, short enough that a fold is followed promptly.
#define SH_STALE_TICKS 30

/**
 * Follow the hinge: when the current panel stops redrawing but another one
 * starts, the system has swapped displays (the Duo lights its cover panel when
 * folded and its inner panel when open) and capture has to move with it.
 *
 * Only a candidate that is *actively* redrawing wins, so a genuinely static
 * screen — every panel idle — leaves the current choice alone.
 */
static void _followLiveDisplay(IOSurfaceRef current) {
    static uint32_t staleTicks = 0;
    static uint32_t lastSeed = 0;
    static NSArray *seedSnapshot = nil;

    // A panel going black is the fold's clearest signal, and it arrives long
    // before the redraw timeout would.
    if (_surfaceIsDark(current) && g_displayCandidates.count > 1) {
        for (id desc in g_displayCandidates) {
            if (desc == g_displayDescriptor) continue;
            IOSurfaceRef s = _surfaceForDescriptor(desc);
            if (!s || _surfaceIsDark(s)) continue;

            NSLog(@"[Framebuffer] Panel went dark — following the lit one (%zux%zu)",
                  IOSurfaceGetWidth(s), IOSurfaceGetHeight(s));
            g_displayDescriptor = desc;
            staleTicks = 0;
            lastSeed = 0;
            seedSnapshot = nil;
            return;
        }
    }

    uint32_t seed = IOSurfaceGetSeed(current);
    if (seed != lastSeed) {
        lastSeed = seed;
        staleTicks = 0;
        seedSnapshot = nil;
        return;
    }
    if (++staleTicks < SH_STALE_TICKS || g_displayCandidates.count < 2) {
        return;
    }

    // First tick past the threshold just records where every panel stands; the
    // comparison needs two samples separated in time.
    if (!seedSnapshot) {
        NSMutableArray *seeds = [NSMutableArray array];
        for (id desc in g_displayCandidates) {
            IOSurfaceRef s = _surfaceForDescriptor(desc);
            [seeds addObject:@(s ? IOSurfaceGetSeed(s) : 0)];
        }
        seedSnapshot = seeds;
        return;
    }

    for (NSUInteger i = 0; i < g_displayCandidates.count; i++) {
        id desc = g_displayCandidates[i];
        if (desc == g_displayDescriptor) continue;
        IOSurfaceRef s = _surfaceForDescriptor(desc);
        if (!s || IOSurfaceGetSeed(s) == [seedSnapshot[i] unsignedIntValue]) continue;

        NSLog(@"[Framebuffer] Display swapped — following panel #%lu (%zux%zu)",
              (unsigned long)i, IOSurfaceGetWidth(s), IOSurfaceGetHeight(s));
        g_displayDescriptor = desc;
        staleTicks = 0;
        lastSeed = 0;
        seedSnapshot = nil;
        return;
    }
    seedSnapshot = nil;
    staleTicks = 0;
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

    g_displayCandidates = candidates;
    g_displayDescriptor = _pickLiveDisplay(candidates) ?: fallbackDescriptor;

    if (!g_displayDescriptor) {
        NSLog(@"[Framebuffer] No com.apple.framebuffer.display port found (%lu ports total)",
              (unsigned long)ports.count);
        g_displayCandidates = nil;
        g_ioClient = nil;
        return NO;
    }

    return YES;
}

/// Describe the panel being captured: its buffer size and the UI orientation
/// the system is rendering into it. The framebuffer is always panel-native, so
/// a rotated UI arrives rotated and only `uiOrientation` says by how much.
/// Returns NO when there is nothing to report.
BOOL SHDisplayInfo(int32_t *width, int32_t *height,
                   uint32_t *uiOrientation, uint32_t *screenID) {
    if (!g_displayDescriptor) return NO;

    IOSurfaceRef surface = _surfaceForDescriptor(g_displayDescriptor);
    if (!surface) return NO;
    *width = (int32_t)IOSurfaceGetWidth(surface);
    *height = (int32_t)IOSurfaceGetHeight(surface);
    *uiOrientation = 0;
    *screenID = 0;

    @try {
        id props = ((id (*)(id, SEL))objc_msgSend)(
            g_displayDescriptor, NSSelectorFromString(@"screenProperties"));
        if (props) {
            *uiOrientation = ((uint32_t (*)(id, SEL))objc_msgSend)(
                props, NSSelectorFromString(@"uiOrientation"));
            *screenID = ((uint32_t (*)(id, SEL))objc_msgSend)(
                props, NSSelectorFromString(@"screenID"));
        }
    } @catch (NSException *e) {
        // Older runtimes may not carry screenProperties — size alone still helps.
    }

    return YES;
}

/// Re-pick the live panel right now, for when the caller already knows the
/// hinge moved. The tick's own follow eventually gets there, but only after the
/// old panel has stayed dark for a while.
void SHRefreshDisplay(void) {
    if (g_displayCandidates.count < 2) return;
    id live = _pickLiveDisplay(g_displayCandidates);
    if (live && live != g_displayDescriptor) {
        IOSurfaceRef s = _surfaceForDescriptor(live);
        NSLog(@"[Framebuffer] Display refreshed — now on %zux%zu",
              s ? IOSurfaceGetWidth(s) : 0, s ? IOSurfaceGetHeight(s) : 0);
        g_displayDescriptor = live;
    }
}

int32_t SHStartFramebuffer(id device, SHFrameCallback callback) {
    SHStopFramebuffer();

    if (!device || !callback) return -1;
    g_frameCallback = callback;
    g_captureDevice = device;
    SHEncoderSetLocalCallback(callback);

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

        _followLiveDisplay(surface);

        int32_t w = (int32_t)IOSurfaceGetWidth(surface);
        int32_t h = (int32_t)IOSurfaceGetHeight(surface);

        // Wrap the IOSurface (32BGRA) zero-copy in a CVPixelBuffer and encode.
        CVPixelBufferRef pb = NULL;
        CVReturn cvret = CVPixelBufferCreateWithIOSurface(NULL, surface, NULL, &pb);
        if (cvret != kCVReturnSuccess || !pb) {
            if (pb) CVPixelBufferRelease(pb);
            return;
        }
        SHEncoderEncode(pb, w, h);
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

    SHEncoderStopAll();

    g_displayDescriptor = nil;
    g_ioClient = nil;
    g_captureDevice = nil;
    g_frameCallback = NULL;
}
