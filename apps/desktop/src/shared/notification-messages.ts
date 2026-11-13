import type { SupportedLocale } from 'quotern-i18n';

const rows: Record<string, readonly [string, string, string, string]> = {
  'notifications.title': ['通知', 'Notifications', '通知', '알림'],
  'notifications.agentComplete': ['本轮完成', 'Turn completed', '応答完了', '응답 완료'],
  'notifications.agentConfirmation': ['需要确认或回答', 'Confirmation or answer needed', '確認・回答が必要', '확인 또는 답변 필요'],
  'notifications.agentError': ['Agent 错误', 'Agent errors', 'Agent エラー', 'Agent 오류'],
  'notifications.quota': ['额度提醒', 'Quota alerts', '利用枠の通知', '할당량 알림'],
  'notifications.service': ['服务状态变化', 'Service status changes', 'サービス状況の変化', '서비스 상태 변경'],
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
  'notifications.unsupported': ['当前系统暂不支持原生通知。', 'Native notifications are unavailable on this system.', 'このシステムではネイティブ通知を利用できません。', '이 시스템에서 기본 알림을 사용할 수 없습니다.'],
  'notifications.restore': ['恢复默认设置', 'Restore defaults', '初期設定に戻す', '기본값 복원'],
  'notifications.retry': ['重试', 'Retry', '再試行', '다시 시도'],
  'notifications.connections': ['Agent 连接', 'Agent connections', 'Agent 接続', 'Agent 연결'],
  'notifications.connect': ['连接通知', 'Connect notifications', '通知を接続', '알림 연결'],
  'notifications.update': ['更新连接', 'Update connection', '接続を更新', '연결 업데이트'],
  'notifications.connected': ['Hook 已安装', 'Hooks installed', 'Hook 設定済み', 'Hook 설치됨'],
  'notifications.notConnected': ['尚未连接', 'Not connected', '未接続', '연결 안 됨'],
  'notifications.connectionHelp': ['确认与错误提醒需要安装本地 Hook，保留其他 Hook；只记录事件元数据，不保存消息或工具输入输出。Codex 首次安装或更新后，请在 /hooks 或设置 > Hooks 中审核并信任本次 Hook，安装状态不代表已经获得信任。', 'Confirmation and error alerts use local hooks, preserving other hooks and saving only event metadata, never messages or tool inputs/outputs. After installing or updating Codex hooks, review and trust them in /hooks or Settings > Hooks. Installed does not mean trusted.', '確認・エラー通知にはローカル Hook を使います。既存 Hook を保持し、イベントのメタデータだけを記録します。メッセージやツール入出力は保存しません。Codex で追加・更新した後は /hooks または設定 > Hooks で確認して信頼してください。設定済みは信頼済みを意味しません。', '확인 및 오류 알림은 다른 Hook을 보존하며 로컬 Hook을 사용합니다. 이벤트 메타데이터만 기록하며 메시지나 도구 입출력은 저장하지 않습니다. Codex Hook 설치·업데이트 후 /hooks 또는 설정 > Hooks에서 검토하고 신뢰하세요. 설치됨은 신뢰됨을 의미하지 않습니다.'],
  'notifications.isolated': ['开发实例不修改真实 Agent 连接。', 'Development instances do not change real Agent connections.', '開発インスタンスでは実際の Agent 接続を変更しません。', '개발 인스턴스는 실제 Agent 연결을 변경하지 않습니다.'],
  'notifications.policyHelp': ['“仅后台”在 Quotern 窗口获得焦点时不提醒。订阅中的提醒类型和账号规则仍然生效。', 'Background mode suppresses alerts while a Quotern window is focused. Subscription alert types and account rules still apply.', 'バックグラウンドのみでは Quotern にフォーカスがある間は通知しません。サブスクリプションの通知種類・アカウント規則も適用されます。', '백그라운드 모드는 Quotern 창에 포커스가 있으면 알리지 않습니다. 구독 알림 유형과 계정 규칙도 적용됩니다.'],
  'notifications.testTitle': ['Quotern 测试通知', 'Quotern test notification', 'Quotern テスト通知', 'Quotern 테스트 알림'],
  'notifications.testBody': ['通知通道已连接。点击打开 Quotern。', 'Notification channel connected. Click to open Quotern.', '通知経路が接続されています。クリックして Quotern を開きます。', '알림 채널이 연결되었습니다. 클릭하면 Quotern이 열립니다.'],
  'notifications.completeTitle': ['{{source}} 本轮完成', '{{source}} turn completed', '{{source}} 応答完了', '{{source}} 응답 완료'],
  'notifications.completeBody': ['本轮响应已结束。点击查看会话。', 'The response has ended. Click to view the session.', '今回の応答が終了しました。クリックしてセッションを表示します。', '이번 응답이 종료되었습니다. 클릭하여 세션을 확인하세요.'],
  'notifications.confirmationTitle': ['{{source}} 需要确认或回答', '{{source}} needs your input', '{{source}} が確認・回答を待っています', '{{source}} 확인 또는 답변 필요'],
  'notifications.confirmationBody': ['请回到 Agent 确认或回答；点击查看相关会话。', 'Return to the Agent to confirm or answer. Click to view the related session.', 'Agent に戻って確認・回答してください。クリックすると関連セッションを表示します。', 'Agent로 돌아가 확인하거나 답변하세요. 클릭하면 관련 세션이 열립니다.'],
  'notifications.errorTitle': ['{{source}} 报告错误', '{{source}} reported an error', '{{source}} でエラーが発生', '{{source}} 오류 보고'],
  'notifications.errorBody': ['Agent 报告了明确错误。点击查看会话。', 'The Agent reported an explicit error. Click to view the session.', 'Agent がエラーを報告しました。クリックしてセッションを表示します。', 'Agent가 오류를 보고했습니다. 클릭하여 세션을 확인하세요.'],
};
const locales: readonly SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ko'];
export const notificationMessages = Object.fromEntries(locales.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]]))])) as Record<SupportedLocale, Record<string, string>>;
export function notificationText(locale: SupportedLocale, key: string, variables: Record<string, string> = {}): string {
  let value = notificationMessages[locale]?.[`notifications.${key}`] ?? notificationMessages.en[`notifications.${key}`] ?? key;
  for (const [name, text] of Object.entries(variables)) value = value.replaceAll(`{{${name}}}`, text);
  return value;
}
