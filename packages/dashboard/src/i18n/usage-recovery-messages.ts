import { registerMessages, type SupportedLocale } from 'quotern-i18n';

const entries = {
  'recovery.title': ['补录旧日志用量', 'Recover usage from old logs', '古いログから使用量を復元', '이전 로그에서 사용량 복구'],
  'recovery.help': ['选择 Claude Code 的原始 .jsonl 日志。预览不会写入统计；确认后只补入能核对的用量，不导入对话内容。', 'Choose original Claude Code .jsonl logs. Preview does not change usage. Import adds verifiable usage without keeping conversation text.', 'Claude Code の元の .jsonl ログを選択します。プレビューは使用量を変更しません。確認できた使用量のみを追加し、会話本文は保存しません。', 'Claude Code의 원본 .jsonl 로그를 선택하세요. 미리보기는 사용량을 변경하지 않습니다. 확인 가능한 사용량만 추가하고 대화 내용은 저장하지 않습니다.'],
  'recovery.choose': ['选择 Claude Code 旧日志', 'Choose old Claude Code logs', 'Claude Code の古いログを選択', '이전 Claude Code 로그 선택'],
  'recovery.preview': ['预览补录', 'Preview recovery', '復元をプレビュー', '복구 미리보기'],
  'recovery.scanning': ['正在核对日志与本机统计…', 'Checking logs against local usage…', 'ログをローカルの使用量と照合中…', '로그를 로컬 사용량과 대조하는 중…'],
  'recovery.confirm': ['确认补录', 'Import missing usage', '不足分をインポート', '누락된 사용량 가져오기'],
  'recovery.applying': ['正在补录并更新统计…', 'Importing and updating usage…', '使用量をインポートして更新中…', '사용량을 가져와 업데이트하는 중…'],
  'recovery.total': ['可补录 {{tokens}} Token · {{count}} 条请求', 'Can recover {{tokens}} tokens · {{count}} requests', '{{tokens}} Token・{{count}} 件を復元可能', '{{tokens}} 토큰 · 요청 {{count}}개 복구 가능'],
  'recovery.applied': ['已补录 {{tokens}} Token · {{count}} 条请求', 'Recovered {{tokens}} tokens · {{count}} requests', '{{tokens}} Token・{{count}} 件を復元しました', '{{tokens}} 토큰 · 요청 {{count}}개 복구 완료'],
  'recovery.empty': ['没有可安全补录的用量。', 'No usage can safely be added.', '安全に追加できる使用量はありません。', '안전하게 추가할 수 있는 사용량이 없습니다.'],
  'recovery.excluded': ['已计入 {{duplicate}} 条；无法确认 {{uncertain}} 条；跳过 {{files}} 个文件。', 'Already counted: {{duplicate}}. Unverified: {{uncertain}}. Files skipped: {{files}}.', '計上済み：{{duplicate}} 件、未確認：{{uncertain}} 件、除外：{{files}} ファイル。', '이미 집계: {{duplicate}}개, 확인 불가: {{uncertain}}개, 건너뛴 파일: {{files}}개.'],
  'recovery.dates': ['按统计日期查看', 'View by reporting date', '集計日別に表示', '집계 날짜별 보기'],
  'recovery.moreDates': ['这里显示前 {{shown}} 天；确认后补录预览合计所含的全部 {{total}} 天。', 'Showing the first {{shown}} dates. Confirming imports all {{total}} dates in the preview total.', '先頭 {{shown}} 日を表示しています。確認すると合計に含まれる全 {{total}} 日を取り込みます。', '처음 {{shown}}일만 표시합니다. 확인하면 합계에 포함된 {{total}}일 전체를 가져옵니다.'],
  'recovery.tooLarge': ['每次最多选择 20 个文件、合计 8 MiB。请分批预览。', 'Select up to 20 files and 8 MiB total per batch.', '1 回に 20 ファイル、合計 8 MiB まで選択できます。', '한 번에 파일 20개, 총 8 MiB까지 선택하세요.'],
  'recovery.storeFull': ['本地补录记录已达到容量上限，未保存这次补录。', 'The local recovery archive is full. This import was not saved.', '復元記録の容量上限に達しました。今回のインポートは保存されていません。', '로컬 복구 기록의 용량이 가득 찼습니다. 이번 가져오기는 저장되지 않았습니다.'],
  'recovery.changed': ['用量已变化或预览已过期，请重新预览后确认。', 'Usage changed or the preview expired. Preview again before importing.', '使用量が変更されたか、プレビューの期限が切れました。もう一度プレビューしてください。', '사용량이 변경되었거나 미리보기가 만료되었습니다. 다시 미리 보세요.'],
  'recovery.owner': ['请在当前负责采集的 Quotern 实例中补录。', 'Import in the Quotern instance that is collecting usage.', '使用量を収集している Quotern インスタンスでインポートしてください。', '사용량을 수집 중인 Quotern 인스턴스에서 가져오세요.'],
  'recovery.refreshPending': ['记录已保存，部分统计未能立即更新。重新打开应用可刷新。', 'Usage was saved, but some totals could not refresh. Reopen the app to refresh them.', '使用量は保存済みですが、一部の集計を更新できませんでした。アプリを開き直してください。', '사용량은 저장되었지만 일부 통계를 새로 고치지 못했습니다. 앱을 다시 열어 주세요.'],
  'recovery.unsupported': ['请选择 Claude Code 的 .jsonl 日志。', 'Choose Claude Code .jsonl logs.', 'Claude Code の .jsonl ログを選択してください。', 'Claude Code의 .jsonl 로그를 선택하세요.'],
  'credits.expirations': ['重置资格到期时间', 'Reset credit expiration', 'リセット枠の有効期限', '초기화 크레딧 만료일'],
  'credits.expiryUnavailable': ['到期时间未知', 'Expiration unavailable', '有効期限不明', '만료일을 확인할 수 없음'],
  'credits.someExpiryUnavailable': ['部分重置资格的到期时间未知', 'Some expiration dates are unavailable', '一部の有効期限は不明です', '일부 크레딧의 만료일을 확인할 수 없음'],
} as const;

registerMessages(Object.fromEntries((['zh-CN', 'en', 'ja', 'ko'] as SupportedLocale[]).map((locale, index) => [locale, Object.fromEntries(Object.entries(entries).map(([key, values]) => [key, values[index]]))])) as Record<SupportedLocale, Record<string, string>>);
