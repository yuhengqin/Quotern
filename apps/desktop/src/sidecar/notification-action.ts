import { forwardNotificationActivation } from '../main/notifications/activation';
void forwardNotificationActivation(process.argv.slice(2)).then(
  delivered => { process.exitCode = delivered ? 0 : 1; },
  () => { process.exitCode = 1; },
);
