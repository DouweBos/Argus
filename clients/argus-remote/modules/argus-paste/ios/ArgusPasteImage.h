#import <Foundation/Foundation.h>

/// Posted when the user picks Paste on a focused text input and the pasteboard
/// holds an image. `userInfo[@"data"]` is a base64 PNG.
extern NSString *const ArgusPasteImageNotification;
