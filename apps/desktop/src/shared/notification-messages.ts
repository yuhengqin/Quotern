import type { SupportedLocale } from 'quotern-i18n';

const rows: Record<string, readonly [string, string, string, string]> = {
  'notifications.title': ['通知', 'Notifications', '通知', '알림'],
  'notifications.quota': ['额度提醒', 'Quota alerts', '利用枠の通知', '할당량 알림'],
  'notifications.service': ['Agent 服务状态变化', 'Agent service status changes', 'Agent サービスの状態変化', 'Agent 서비스 상태 변경'],
  'notifications.off': ['从不', 'Never', '通知しない', '안 함'],
  'notifications.background': ['仅后台', 'Only in background', 'バックグラウンドのみ', '백그라운드에서만'],
  'notifications.always': ['始终', 'Always', '常に', '항상'],
  'notifications.sound': ['提示音', 'Notification sound', '通知音', '알림 소리'],
  'notifications.none': ['关闭声音', 'No sound', 'サウンドなし', '소리 없음'],
  'notifications.soft': ['柔和', 'Soft', 'ソフト', '부드럽게'],
  'notifications.bell': ['清脆', 'Chime', 'チャイム', '차임'],
  'notifications.preview': ['试听', 'Preview sound', '試聴', '미리 듣기'],
  'notifications.test': ['测试通知', 'Test notification', '通知をテスト', '알림 테스트'],
  'notifications.shown': ['系统已确认显示测试通知。', 'The system confirmed the test notification was shown.', 'システムがテスト通知の表示を確認しました。', '시스템이 테스트 알림 표시를 확인했습니다.'],
  'notifications.requested': ['已请求发送，请在系统通知中心查看。', 'Delivery requested. Check your system notification center.', '送信を要求しました。通知センターをご確認ください。', '전송을 요청했습니다. 시스템 알림 센터를 확인하세요.'],
  'notifications.failed': ['操作失败，请重试；保存失败时原设置仍然生效。', 'Action failed. Retry; a failed save keeps the previous settings.', '操作に失敗しました。再試行してください。保存失敗時は元の設定が有効です。', '작업에 실패했습니다. 다시 시도하세요. 저장 실패 시 기존 설정이 유지됩니다.'],
  'notifications.loadIssue': ['通知设置无法读取，已暂停提醒。可恢复默认设置后重试。', 'Notification settings could not be read. Alerts are paused; restore defaults to retry.', '通知設定を読み込めません。通知を停止しました。初期設定に戻して再試行できます。', '알림 설정을 읽을 수 없습니다. 알림을 중지했습니다. 기본값을 복원한 뒤 다시 시도하세요.'],
  'notifications.deliveryIssue': ['系统通知未能送达，请检查系统通知权限。', 'Notification delivery failed. Check system notification permissions.', '通知を送信できません。システムの通知権限をご確認ください。', '알림을 전송하지 못했습니다. 시스템 알림 권한을 확인하세요.'],
  'notifications.soundIssue': ['提示音未能播放，请检查系统声音设置。', 'The sound could not be played. Check system audio settings.', '通知音を再生できません。システムの音声設定をご確認ください。', '알림 소리를 재생하지 못했습니다. 시스템 소리 설정을 확인하세요.'],
  'notifications.integrationIssue': ['通知名称、图标或快捷操作注册失败。基础通知仍可使用，请重启 Quotern 后重试。', 'Notification identity or quick actions could not be registered. Basic notifications remain available. Restart Quotern to retry.', '通知の名前・アイコンまたは操作を登録できません。基本通知は利用できます。Quotern を再起動してください。', '알림 이름, 아이콘 또는 빠른 작업을 등록하지 못했습니다. 기본 알림은 계속 사용할 수 있습니다. Quotern을 다시 시작하세요.'],
  'notifications.unsupported': ['当前系统暂不支持原生通知。', 'Native notifications are unavailable on this system.', 'このシステムではネイティブ通知を利用できません。', '이 시스템에서 기본 알림을 사용할 수 없습니다.'],
  'notifications.restore': ['恢复默认设置', 'Restore defaults', '初期設定に戻す', '기본값 복원'],
  'notifications.retry': ['重试', 'Retry', '再試行', '다시 시도'],
  'notifications.policyHelp': ['“仅后台”在 Quotern 窗口获得焦点时不提醒。订阅中的提醒类型和账号规则仍然生效。服务提醒针对所关注厂商服务的状态变化，事件内容更新不会单独提醒。', 'Background mode suppresses alerts while a Quotern window is focused. Subscription alert types and account rules still apply. Service alerts cover status changes for the provider services you follow; incident content updates do not trigger separate alerts.', 'バックグラウンドのみでは Quotern にフォーカスがある間は通知しません。サブスクリプションの通知種類・アカウント規則も適用されます。サービス通知は選択したプロバイダーの状態変化が対象で、インシデント本文の更新だけでは通知しません。', '백그라운드 모드는 Quotern 창에 포커스가 있으면 알리지 않습니다. 구독 알림 유형과 계정 규칙도 적용됩니다. 서비스 알림은 관심 공급자 서비스의 상태 변경을 대상으로 하며, 사고 내용만 업데이트되면 별도로 알리지 않습니다.'],
  'notifications.testTitle': ['Quotern 测试通知', 'Quotern test notification', 'Quotern テスト通知', 'Quotern 테스트 알림'],
  'notifications.testBody': ['通知通道已连接。点击打开 Quotern。', 'Notification channel connected. Click to open Quotern.', '通知経路が接続されています。クリックして Quotern を開きます。', '알림 채널이 연결되었습니다. 클릭하면 Quotern이 열립니다.'],
  'notifications.view': ['查看详情', 'View details', '詳細を表示', '자세히 보기'],
  'notifications.snooze': ['30 分钟后提醒', 'Remind in 30 minutes', '30分後に通知', '30분 후 알림'],
  'notifications.level.minor': ['性能下降', 'Degraded performance', '性能低下', '성능 저하'],
  'notifications.level.major': ['部分服务中断', 'Partial outage', '一部のサービスが停止', '일부 서비스 중단'],
  'notifications.level.critical': ['严重服务中断', 'Major outage', '重大なサービス停止', '심각한 서비스 중단'],
  'notifications.level.maintenance': ['计划维护', 'Scheduled maintenance', '計画メンテナンス', '예정된 유지보수'],
  'notifications.level.unknown': ['状态未知', 'Unknown status', '状態不明', '알 수 없는 상태'],
  'notifications.serviceRecoveredBody': ['所关注的服务已恢复正常。', 'The services you follow are operational again.', '選択したサービスは正常に復旧しました。', '관심 서비스가 정상으로 복구되었습니다.'],
};
const locales: readonly SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ko'];
export const notificationMessages = Object.fromEntries(locales.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]]))])) as Record<SupportedLocale, Record<string, string>>;
export function notificationText(locale: SupportedLocale, key: string, variables: Record<string, string> = {}): string {
  let value = notificationMessages[locale]?.[`notifications.${key}`] ?? notificationMessages.en[`notifications.${key}`] ?? key;
  for (const [name, text] of Object.entries(variables)) value = value.replaceAll(`{{${name}}}`, text);
  return value;
}
