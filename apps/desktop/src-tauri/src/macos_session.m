#include <CoreGraphics/CoreGraphics.h>
#include <stdbool.h>

bool quotern_macos_session_unlocked(void) {
    CFDictionaryRef session = CGSessionCopyCurrentDictionary();
    if (!session) return false;

    CFTypeRef onConsole = CFDictionaryGetValue(session, kCGSessionOnConsoleKey);
    CFTypeRef loggedIn = CFDictionaryGetValue(session, kCGSessionLoginDoneKey);
    // Quartz omits this screen-lock field in some unlocked sessions.
    CFTypeRef locked = CFDictionaryGetValue(session, CFSTR("CGSSessionScreenIsLocked"));
    bool unlocked = onConsole == kCFBooleanTrue && loggedIn == kCFBooleanTrue
        && (!locked || locked == kCFBooleanFalse);
    CFRelease(session);
    return unlocked;
}
