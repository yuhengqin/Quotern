#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

typedef void (*QuoternAction)(const char *, const char *);
static QuoternAction actionCallback;
static NSMutableDictionary<NSString *, UNNotificationCategory *> *categories;

@interface QuoternNoticeDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation QuoternNoticeDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))complete {
    complete(UNNotificationPresentationOptionAlert);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))complete {
    NSString *action = response.actionIdentifier;
    if ([action isEqual:UNNotificationDefaultActionIdentifier]) action = @"view";
    if (actionCallback && [@[@"view", @"snooze", @"dismiss-all"] containsObject:action]) {
        actionCallback(response.notification.request.identifier.UTF8String, action.UTF8String);
    }
    complete();
}
@end

static QuoternNoticeDelegate *delegate;
void quotern_mac_notification_actions(QuoternAction callback) {
    // A raw development executable may run outside an application bundle.
    if (!NSBundle.mainBundle.bundleIdentifier) return;
    actionCallback = callback;
    delegate = [QuoternNoticeDelegate new];
    categories = [NSMutableDictionary new];
    UNUserNotificationCenter.currentNotificationCenter.delegate = delegate;
}

// Called on a Rust blocking worker. Return 1 for a scheduled notification, 0 for failure.
int quotern_mac_notification_show(const char *json) {
    @autoreleasepool {
        if (!delegate) return 0;
        NSDictionary *notice = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        if (![notice isKindOfClass:NSDictionary.class]) return 0;
        UNMutableNotificationContent *content = [UNMutableNotificationContent new];
        content.title = notice[@"title"];
        content.body = notice[@"body"];
        NSMutableArray *actions = [NSMutableArray new];
        NSMutableArray *ids = [NSMutableArray new];
        for (NSString *key in notice[@"actions"]) {
            NSString *label = notice[@"actionLabels"][key];
            if (!label) continue;
            [ids addObject:key];
            UNNotificationActionOptions options = [key isEqual:@"view"] ? UNNotificationActionOptionForeground : UNNotificationActionOptionNone;
            [actions addObject:[UNNotificationAction actionWithIdentifier:key title:label options:options]];
        }
        content.categoryIdentifier = [NSString stringWithFormat:@"%@-%@", notice[@"locale"], [ids componentsJoinedByString:@"."]];
        UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
        @synchronized(categories) {
            if (!categories[content.categoryIdentifier]) {
                categories[content.categoryIdentifier] = [UNNotificationCategory categoryWithIdentifier:content.categoryIdentifier actions:actions intentIdentifiers:@[] options:UNNotificationCategoryOptionNone];
                [center setNotificationCategories:[NSSet setWithArray:categories.allValues]];
            }
        }
        UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:notice[@"id"] content:content trigger:nil];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block BOOL scheduled = NO;
        // Permission responses may arrive after a user has cleared the pending request.
        __block BOOL expired = NO;
        NSObject *guard = [NSObject new];
        [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert completionHandler:^(BOOL granted, NSError *error) {
            @synchronized(guard) {
                if (!granted || error || expired) { dispatch_semaphore_signal(done); return; }
                [center addNotificationRequest:request withCompletionHandler:^(NSError *failure) {
                    @synchronized(guard) {
                        scheduled = (failure == nil);
                        if (expired && scheduled) {
                            [center removePendingNotificationRequestsWithIdentifiers:@[request.identifier]];
                            [center removeDeliveredNotificationsWithIdentifiers:@[request.identifier]];
                        }
                    }
                    dispatch_semaphore_signal(done);
                }];
            }
        }];
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_SEC))) {
            @synchronized(guard) { expired = YES; }
            return 0;
        }
        return scheduled ? 1 : 0;
    }
}
void quotern_mac_notification_remove(const char *key) {
    @autoreleasepool {
        if (!delegate) return;
        NSArray *ids = @[[NSString stringWithUTF8String:key]];
        [UNUserNotificationCenter.currentNotificationCenter removePendingNotificationRequestsWithIdentifiers:ids];
        [UNUserNotificationCenter.currentNotificationCenter removeDeliveredNotificationsWithIdentifiers:ids];
    }
}
