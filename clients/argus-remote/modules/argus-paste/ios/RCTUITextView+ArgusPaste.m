#import "ArgusPasteImage.h"

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

NSString *const ArgusPasteImageNotification = @"ArgusPasteImageNotification";

/**
 * React Native's text input is a plain UITextView, so iOS never offers Paste
 * when the pasteboard holds an image — `canPerformAction:` says no, and there
 * is no `onPaste` hook in RN 0.76's Fabric text input to use instead.
 *
 * So we say yes ourselves, and intercept the paste to hand the image to JS
 * rather than letting UITextView drop it. Everything else falls through to the
 * original implementation untouched.
 */
@interface UITextView (ArgusPaste)
@end

@implementation UITextView (ArgusPaste)

static void ArgusSwizzle(Class cls, SEL original, SEL replacement) {
  Method a = class_getInstanceMethod(cls, original);
  Method b = class_getInstanceMethod(cls, replacement);
  if (a && b) {
    method_exchangeImplementations(a, b);
  }
}

+ (void)load {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    ArgusSwizzle(self, @selector(canPerformAction:withSender:),
                 @selector(argus_canPerformAction:withSender:));
    ArgusSwizzle(self, @selector(paste:), @selector(argus_paste:));
  });
}

/// Only meddle with React Native's own text views, not any UIKit one UIKit
/// might put on screen for us (autofill sheets, the edit menu, and so on).
- (BOOL)argus_isReactTextView {
  Class rn = NSClassFromString(@"RCTUITextView");
  return rn != nil && [self isKindOfClass:rn];
}

- (BOOL)argus_canPerformAction:(SEL)action withSender:(id)sender {
  if (action == @selector(paste:) && [self argus_isReactTextView] &&
      UIPasteboard.generalPasteboard.hasImages) {
    return YES;
  }
  // Not ours: this is the original implementation after the swap.
  return [self argus_canPerformAction:action withSender:sender];
}

- (void)argus_paste:(id)sender {
  if ([self argus_isReactTextView] && UIPasteboard.generalPasteboard.hasImages) {
    UIImage *image = UIPasteboard.generalPasteboard.image;
    NSData *png = image ? UIImagePNGRepresentation(image) : nil;
    if (png) {
      [NSNotificationCenter.defaultCenter
          postNotificationName:ArgusPasteImageNotification
                        object:nil
                      userInfo:@{@"data" : [png base64EncodedStringWithOptions:0]}];
      return;
    }
  }
  [self argus_paste:sender];
}

@end
