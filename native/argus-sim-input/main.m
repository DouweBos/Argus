// argus-sim-input — HID injection helper that runs *inside* a simulator.
//
// The legacy SimulatorKit Indigo path only still delivers digitizer events;
// keyboard and hardware-button messages are accepted and dropped (verified on
// iOS 18.3 through 27.1). The modern route is the guest's own HID event system,
// which is only reachable from a process running in the simulator — hence this
// separate iphonesimulator-platform binary, launched via `simctl spawn` and fed
// newline-delimited JSON on stdin:
//
//   {"cmd":"key","page":7,"usage":4,"down":true}   -> {"ok":true}
//   {"cmd":"button","page":12,"usage":64}          -> {"ok":true}   (down+up)

#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <mach/mach_time.h>

typedef void *IOHIDEventSystemClientRef;
typedef void *IOHIDEventRef;
typedef IOHIDEventSystemClientRef (*ClientCreateFn)(CFAllocatorRef);
typedef IOHIDEventRef (*KeyboardEventFn)(CFAllocatorRef, uint64_t, uint32_t,
                                         uint32_t, Boolean, uint32_t);
typedef void (*DispatchFn)(IOHIDEventSystemClientRef, IOHIDEventRef);

/// Milliseconds a synthesised hardware-button press is held.
static const useconds_t kButtonHoldUs = 60000;

static ClientCreateFn gClientCreate;
static KeyboardEventFn gKeyboardEvent;
static DispatchFn gDispatch;
static IOHIDEventSystemClientRef gClient;

static void respond(BOOL ok, NSString *error) {
    NSMutableDictionary *d = [@{@"ok": @(ok)} mutableCopy];
    if (!ok && error) {
        d[@"error"] = error;
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:d options:0 error:NULL];
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

/// Resolve the guest's HID entry points. They live in the shared cache, so the
/// framework has to be dlopen'd by path rather than linked.
static BOOL loadHID(void) {
    if (gDispatch) {
        return YES;
    }
    dlopen("/System/Library/PrivateFrameworks/HID.framework/HID", RTLD_NOW | RTLD_GLOBAL);
    gClientCreate = (ClientCreateFn)dlsym(RTLD_DEFAULT, "IOHIDEventSystemClientCreate");
    gKeyboardEvent = (KeyboardEventFn)dlsym(RTLD_DEFAULT, "IOHIDEventCreateKeyboardEvent");
    gDispatch = (DispatchFn)dlsym(RTLD_DEFAULT, "IOHIDEventSystemClientDispatchEvent");
    if (!gClientCreate || !gKeyboardEvent || !gDispatch) {
        return NO;
    }
    gClient = gClientCreate(kCFAllocatorDefault);

    return gClient != NULL;
}

static BOOL sendUsage(uint32_t page, uint32_t usage, BOOL down) {
    IOHIDEventRef event = gKeyboardEvent(kCFAllocatorDefault, mach_absolute_time(),
                                         page, usage, down, 0);
    if (!event) {
        return NO;
    }
    gDispatch(gClient, event);
    CFRelease(event);

    return YES;
}

static void dispatchCommand(NSDictionary *obj) {
    NSString *cmd = obj[@"cmd"];
    NSNumber *page = obj[@"page"];
    NSNumber *usage = obj[@"usage"];
    if (![cmd isKindOfClass:NSString.class] || !page || !usage) {
        respond(NO, @"missing required field(s)");
        return;
    }
    uint32_t p = page.unsignedIntValue;
    uint32_t u = usage.unsignedIntValue;

    if ([cmd isEqualToString:@"key"]) {
        BOOL down = [obj[@"down"] boolValue];
        respond(sendUsage(p, u, down), down ? @"key down failed" : @"key up failed");
    } else if ([cmd isEqualToString:@"button"]) {
        if (!sendUsage(p, u, YES)) {
            respond(NO, @"button down failed");
            return;
        }
        usleep(kButtonHoldUs);
        respond(sendUsage(p, u, NO), @"button up failed");
    } else {
        respond(NO, [NSString stringWithFormat:@"unknown command '%@'", cmd]);
    }
}

int main(void) {
    @autoreleasepool {
        if (!loadHID()) {
            respond(NO, @"HID event system unavailable");
            return 1;
        }
        char *line = NULL;
        size_t cap = 0;
        ssize_t len;
        while ((len = getline(&line, &cap, stdin)) > 0) {
            NSData *data = [NSData dataWithBytes:line length:(NSUInteger)len];
            NSDictionary *obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
            if (![obj isKindOfClass:NSDictionary.class]) {
                respond(NO, @"invalid JSON");
                continue;
            }
            @autoreleasepool {
                dispatchCommand(obj);
            }
        }
        free(line);
    }

    return 0;
}
