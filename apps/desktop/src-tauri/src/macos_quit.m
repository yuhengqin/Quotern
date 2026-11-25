#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <stdbool.h>

static void (*requestQuit)(void);

static NSApplicationTerminateReply shouldTerminate(id delegate, SEL selector, NSApplication *app) {
    requestQuit();
    return NSTerminateLater;
}

bool quotern_macos_defer_quit(void (*callback)(void)) {
    id<NSApplicationDelegate> delegate = NSApp.delegate;
    SEL selector = @selector(applicationShouldTerminate:);
    if (!delegate || [delegate respondsToSelector:selector]) return false;

    // Keep Tao's delegate and its window callbacks in place.
    struct objc_method_description method =
        protocol_getMethodDescription(@protocol(NSApplicationDelegate), selector, NO, YES);
    if (!method.types || !class_addMethod(object_getClass(delegate), selector, (IMP)shouldTerminate, method.types)) return false;
    requestQuit = callback;
    return true;
}

void quotern_macos_reply_quit(void) {
    CFRunLoopRef main = CFRunLoopGetMain();
    // AppKit waits for the reply in its modal run-loop mode.
    CFRunLoopPerformBlock(main, (__bridge CFStringRef)NSModalPanelRunLoopMode, ^{
        [NSApp replyToApplicationShouldTerminate:YES];
    });
    CFRunLoopWakeUp(main);
}
