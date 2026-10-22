import type { SupportedLocale } from 'quotern-i18n';

// Every CLI key has all four offline translations. Keep identifiers, API values,
// model names and JSON/CSV fields outside this catalog.
const entries: Record<string, [string, string, string, string]> = {
  'lang.missing': ['--lang 需要语言代码：zh-CN | en | ja | ko', '--lang needs a language code: zh-CN | en | ja | ko', '--lang には言語コードが必要です: zh-CN | en | ja | ko', '--lang에 언어 코드가 필요합니다: zh-CN | en | ja | ko'],
  'lang.invalid': ['不支持的 --lang: {{value}}；可用值：zh-CN | en | ja | ko', 'Unsupported --lang: {{value}}; use zh-CN | en | ja | ko', '未対応の --lang: {{value}}。使用可能: zh-CN | en | ja | ko', '지원하지 않는 --lang: {{value}}. 사용 가능: zh-CN | en | ja | ko'],
  'lang.duplicate': ['--lang 参数重复', '--lang was specified more than once', '--lang が重複しています', '--lang 옵션이 중복되었습니다'],
  'arg.sourceUnknown': ['未知的数据源: {{value}}\n可用值: {{sources}}', 'Unknown data source: {{value}}\nAvailable: {{sources}}', '不明なデータソース: {{value}}\n使用可能: {{sources}}', '알 수 없는 데이터 소스: {{value}}\n사용 가능: {{sources}}'],
  'arg.hostEmpty': ['--host 不能为空，例如 0.0.0.0 或 127.0.0.1', '--host cannot be empty; use 0.0.0.0 or 127.0.0.1', '--host を空にできません。例: 0.0.0.0 または 127.0.0.1', '--host는 비워 둘 수 없습니다. 예: 0.0.0.0 또는 127.0.0.1'],
  'arg.hostInvalid': ['无效的 --host: {{value}}', 'Invalid --host: {{value}}', '無効な --host: {{value}}', '잘못된 --host: {{value}}'],
  'arg.portInvalid': ['无效的 --port: {{value}}，请输入 1 到 65535 之间的整数', 'Invalid --port: {{value}}; enter an integer from 1 to 65535', '無効な --port: {{value}}。1 から 65535 の整数を入力してください', '잘못된 --port: {{value}}. 1부터 65535까지의 정수를 입력하세요'],
  'arg.portMissing': ['--port 需要端口号，例如 8252', '--port needs a port number, for example 8252', '--port にはポート番号が必要です。例: 8252', '--port에 포트 번호가 필요합니다. 예: 8252'],
  'arg.hostMissing': ['--host 需要地址，例如 0.0.0.0 或 127.0.0.1', '--host needs an address, for example 0.0.0.0 or 127.0.0.1', '--host にはアドレスが必要です。例: 0.0.0.0 または 127.0.0.1', '--host에 주소가 필요합니다. 예: 0.0.0.0 또는 127.0.0.1'],
  'arg.sourceMissing': ['--source 需要数据源名称', '--source requires a value', '--source にデータソース名が必要です', '--source에 데이터 소스 이름이 필요합니다'],
  'arg.daysMissing': ['--days 需要天数', '--days requires a value', '--days に日数が必要です', '--days에 일수가 필요합니다'],
  'arg.unknownOption': ['未知参数: {{value}}', 'Unknown option: {{value}}', '不明なオプション: {{value}}', '알 수 없는 옵션: {{value}}'],
  'arg.daysPositive': ['--days 须为正整数，收到: {{value}}', '--days must be a positive integer; received: {{value}}', '--days は正の整数にしてください: {{value}}', '--days는 양의 정수여야 합니다: {{value}}'],
  'arg.unknownCommand': ['未知命令: {{value}}', 'Unknown command: {{value}}', '不明なコマンド: {{value}}', '알 수 없는 명령: {{value}}'],
  'arg.helpHint': ['使用 quotern --help 查看可用命令', 'Run quotern --help to see available commands', '利用可能なコマンドは quotern --help で確認できます', '사용 가능한 명령은 quotern --help에서 확인하세요'],
  'arg.serviceUsage': ['用法: quotern service <start|stop|status>', 'Usage: quotern service <start|stop|status>', '使い方: quotern service <start|stop|status>', '사용법: quotern service <start|stop|status>'],
  'common.kind.desktop': ['桌面端', 'Desktop', 'デスクトップ', '데스크톱'],
  'common.kind.cli': ['CLI', 'CLI', 'CLI', 'CLI'],
  'common.never': ['从未', 'Never', 'なし', '없음'],
  'common.running': ['运行中', 'Running', '実行中', '실행 중'],
  'common.stopped': ['未运行', 'Not running', '停止中', '실행 중 아님'],
  'common.active': ['已注册', 'Active', '有効', '활성'],
  'common.polling': ['轮询模式', 'Polling', 'ポーリング', '폴링'],
  'common.minute': ['{{count}} 分钟', '{{count}} minute(s)', '{{count}} 分', '{{count}}분'],
  'common.second': ['{{count}} 秒', '{{count}} second(s)', '{{count}} 秒', '{{count}}초'],
  'common.failed': ['操作失败。请检查数据目录和配置；设置 QUOTERN_DEBUG=1 可查看诊断详情。', 'Operation failed. Check the data directory and configuration; set QUOTERN_DEBUG=1 for diagnostic details.', '操作に失敗しました。データ保存先と設定を確認してください。診断詳細は QUOTERN_DEBUG=1 で表示できます。', '작업에 실패했습니다. 데이터 디렉터리와 설정을 확인하세요. 진단 세부 정보는 QUOTERN_DEBUG=1로 표시할 수 있습니다.'],
  'common.debugDetails': ['诊断详情: {{details}}', 'Diagnostic details: {{details}}', '診断詳細: {{details}}', '진단 세부 정보: {{details}}'],
  'start.alreadyRunning': ['服务已在运行（CLI pid {{pid}}），请先 quotern service stop 或结束该进程', 'Service is already running (CLI pid {{pid}}). Stop it with quotern service stop or end that process.', 'サービスはすでに実行中です（CLI pid {{pid}}）。quotern service stop またはそのプロセスを終了してください。', '서비스가 이미 실행 중입니다 (CLI pid {{pid}}). quotern service stop을 실행하거나 해당 프로세스를 종료하세요.'],
  'start.device': ['设备 UUID: {{uuid}}', 'Device UUID: {{uuid}}', 'デバイス UUID: {{uuid}}', '기기 UUID: {{uuid}}'],
  'start.observer': ['观察模式：{{kind}} (pid {{pid}}) 负责本地采集', 'Observer mode: {{kind}} (pid {{pid}}) collects local data', '閲覧モード: {{kind}} (pid {{pid}}) がローカル収集を担当します', '조회 모드: {{kind}} (pid {{pid}})에서 로컬 데이터를 수집합니다'],
  'start.observerDetail': ['本进程只提供面板读数，不抢占 runtime、不轮询', 'This process only serves dashboard data; it does not take over collection or poll.', 'このプロセスはダッシュボードを表示するだけで、収集を引き継がずポーリングもしません。', '이 프로세스는 대시보드 데이터만 제공하며 수집 권한을 가져오거나 폴링하지 않습니다.'],
  'start.hookFailed': ['⚠ {{source}} Hook 未注册成功，将使用定时轮询（{{interval}}）同步', '⚠ {{source}} Hook registration failed; scheduled polling every {{interval}} will be used.', '⚠ {{source}} Hook の登録に失敗しました。{{interval}} ごとのポーリングで同期します。', '⚠ {{source}} Hook 등록에 실패했습니다. {{interval}}마다 폴링하여 동기화합니다.'],
  'start.hookSkippedIsolated': ['开发隔离模式已跳过 Claude/Codex Hook 注册，使用轮询同步', 'Isolated development skips Claude/Codex Hook registration; using polling.', '隔離開発モードでは Claude/Codex Hook の登録を省略し、ポーリングで同期します。', '격리 개발 모드에서는 Claude/Codex Hook 등록을 건너뛰고 폴링으로 동기화합니다.'],
  'start.backgroundSync': ['后台同步 Claude / Codex / Cursor 数据…', 'Syncing Claude / Codex / Cursor data in the background…', 'Claude / Codex / Cursor のデータをバックグラウンドで同期中…', '백그라운드에서 Claude / Codex / Cursor 데이터를 동기화하는 중…'],
  'start.started': ['✓ Quotern 已启动{{observer}}', '✓ Quotern started{{observer}}', '✓ Quotern を開始しました{{observer}}', '✓ Quotern이 시작되었습니다{{observer}}'],
  'start.observerSuffix': ['（观察模式）', ' (observer mode)', '（閲覧モード）', ' (조회 모드)'],
  'start.panel': ['面板: {{url}}', 'Dashboard: {{url}}', 'ダッシュボード: {{url}}', '대시보드: {{url}}'],
  'start.listen': ['监听: {{host}}:{{port}}（局域网可访问）', 'Listening: {{host}}:{{port}} (LAN accessible)', '待受: {{host}}:{{port}}（LAN からアクセス可能）', '수신: {{host}}:{{port}} (LAN에서 접속 가능)'],
  'start.data': ['数据: {{dir}}', 'Data: {{dir}}', 'データ: {{dir}}', '데이터: {{dir}}'],
  'start.logs': ['调试日志: {{dir}}', 'Diagnostic logs: {{dir}}', '診断ログ: {{dir}}', '진단 로그: {{dir}}'],
  'start.collectDesktop': ['本地采集: 由桌面端负责', 'Local collection: handled by Desktop', 'ローカル収集: デスクトップが担当', '로컬 수집: 데스크톱에서 담당'],
  'start.hookState': ['{{source}} Hook: {{state}}', '{{source}} Hook: {{state}}', '{{source}} Hook: {{state}}', '{{source}} Hook: {{state}}'],
  'start.ctrlC': ['按 Ctrl+C 停止', 'Press Ctrl+C to stop', 'Ctrl+C で停止', 'Ctrl+C를 눌러 중지'],
  'start.pricingOverlay': ['定价覆盖层: {{url}}（启动时拉取一次）', 'Pricing overlay: {{url}} (fetched once at startup)', '価格の上書き: {{url}}（起動時に一度取得）', '가격 오버레이: {{url}} (시작할 때 한 번 가져옴)'],
  'start.pricingLocal': ['定价：使用有效缓存或内置价格（未配置远端地址）', 'Pricing: cached or bundled prices (no remote source configured).', '価格: 保存済みまたは組込の価格を使用します（リモート取得先は未設定）。', '가격: 저장된 가격 또는 기본 가격을 사용합니다 (원격 주소 미설정).'],
  'start.pricingCacheFailed': ['定价覆盖层刷新后重建缓存失败。', 'Could not rebuild the cache after the pricing overlay refresh.', '価格の上書き更新後にキャッシュを再構築できませんでした。', '가격 오버레이를 새로고침한 후 캐시를 다시 만들지 못했습니다.'],
  'start.pricingRefreshFailed': ['远程定价表刷新失败；继续使用内置或上次覆盖。', 'Remote pricing refresh failed; using built-in or cached prices.', 'リモート価格表の更新に失敗しました。組込値または保存済みの価格を使用します。', '원격 가격 새로고침에 실패했습니다. 기본값 또는 저장된 가격을 사용합니다.'],
  'start.pollFailed': ['轮询同步失败。', 'Scheduled sync failed.', '定期同期に失敗しました。', '예약 동기화에 실패했습니다.'],
  'start.startupSyncFailed': ['启动同步失败。', 'Startup sync failed.', '起動時の同期に失敗しました。', '시작 동기화에 실패했습니다.'],
  'sync.skipped': ['{{source}}: 跳过（无数据或来源不可用）', '{{source}}: skipped (no data or source unavailable)', '{{source}}: スキップ（データがないかソースを利用できません）', '{{source}}: 건너뜀 (데이터가 없거나 소스를 사용할 수 없음)'],
  'sync.result': ['{{source}}: {{messages}} 条消息, {{buckets}} 个桶写入, {{files}} 个文件', '{{source}}: {{messages}} messages, {{buckets}} buckets written, {{files}} files', '{{source}}: {{messages}} 件のメッセージ、{{buckets}} 件のバケット、{{files}} 件のファイル', '{{source}}: 메시지 {{messages}}개, 버킷 {{buckets}}개 기록, 파일 {{files}}개'],
  'status.owner': ['Runtime: {{kind}} pid {{pid}}（本地采集）', 'Runtime: {{kind}} pid {{pid}} (local collection)', 'Runtime: {{kind}} pid {{pid}}（ローカル収集）', 'Runtime: {{kind}} pid {{pid}} (로컬 수집)'],
  'status.runtime': ['Runtime: {{state}}', 'Runtime: {{state}}', 'Runtime: {{state}}', 'Runtime: {{state}}'],
  'status.localPanel': ['本进程面板: 运行中{{observer}}', 'Dashboard in this process: running{{observer}}', 'このプロセスのダッシュボード: 実行中{{observer}}', '이 프로세스의 대시보드: 실행 중{{observer}}'],
  'status.observerSuffix': ['（观察模式，只读）', ' (observer mode, read only)', '（閲覧モード、読取専用）', ' (조회 모드, 읽기 전용)'],
  'status.dataDir': ['数据目录: {{dir}}', 'Data directory: {{dir}}', 'データ保存先: {{dir}}', '데이터 디렉터리: {{dir}}'],
  'status.statsSince': ['statsSince: {{date}}', 'statsSince: {{date}}', 'statsSince: {{date}}', 'statsSince: {{date}}'],
  'status.lastSync': ['上次同步: {{date}}', 'Last sync: {{date}}', '最終同期: {{date}}', '마지막 동기화: {{date}}'],
  'status.cursor': ['Cursor: 轮询模式（无 Hook）', 'Cursor: polling (no Hook)', 'Cursor: ポーリング（Hook なし）', 'Cursor: 폴링 (Hook 없음)'],
  'stop.observer': ['观察面板已停止', 'Observer dashboard stopped', '閲覧用ダッシュボードを停止しました', '조회 대시보드를 중지했습니다'],
  'stop.service': ['服务已停止', 'Service stopped', 'サービスを停止しました', '서비스를 중지했습니다'],
  'service.isolated': ['隔离开发模式禁止操作系统级 quotern service；使用 pnpm dev:cli，并通过所属会话退出', 'System-level quotern service is disabled in isolated development mode. Use pnpm dev:cli and stop its own session.', '隔離開発モードではシステムの quotern service は操作できません。pnpm dev:cli を使い、そのセッションから終了してください。', '격리 개발 모드에서는 시스템 수준의 quotern service를 사용할 수 없습니다. pnpm dev:cli를 사용하고 해당 세션에서 종료하세요.'],
  'service.platform': ['quotern service 仅支持 macOS、Windows 与 Linux（当前: {{platform}}）', 'quotern service supports macOS, Windows and Linux only (current: {{platform}})', 'quotern service は macOS、Windows、Linux のみ対応します（現在: {{platform}}）', 'quotern service는 macOS, Windows, Linux만 지원합니다 (현재: {{platform}})'],
  'service.autostartFailed': ['⚠️ 开机自启注册失败。', '⚠️ Could not register login startup.', '⚠️ ログイン時の自動起動を登録できませんでした。', '⚠️ 로그인 시 자동 시작을 등록하지 못했습니다.'],
  'service.autostartHint': ['服务运行不受影响。修复问题后可重新执行 quotern service start。', 'The running service is unaffected. Retry quotern service start after fixing the issue.', '実行中のサービスには影響しません。問題を修正後、quotern service start を再実行してください。', '실행 중인 서비스에는 영향이 없습니다. 문제를 해결한 뒤 quotern service start를 다시 실행하세요.'],
  'service.waiting': ['仍在等待检测中（已 {{seconds}} 秒）…', 'Still waiting for the service ({{seconds}} seconds elapsed)…', 'サービスを待機中（{{seconds}} 秒経過）…', '서비스를 기다리는 중 ({{seconds}}초 경과)…'],
  'service.already': ['服务已在运行（{{kind}} pid {{pid}}）', 'Service is already running ({{kind}} pid {{pid}})', 'サービスはすでに実行中です（{{kind}} pid {{pid}}）', '서비스가 이미 실행 중입니다 ({{kind}} pid {{pid}})'],
  'service.alreadyRegistered': ['服务已在运行（{{kind}} pid {{pid}}），已补注册开机自启', 'Service is running ({{kind}} pid {{pid}}); login startup is now registered', 'サービス実行中（{{kind}} pid {{pid}}）。ログイン時の自動起動を登録しました', '서비스 실행 중 ({{kind}} pid {{pid}}). 로그인 시 자동 시작을 등록했습니다'],
  'service.alreadyUnregistered': ['服务已在运行（{{kind}} pid {{pid}}，开机自启未注册）', 'Service is running ({{kind}} pid {{pid}}); login startup is not registered', 'サービス実行中（{{kind}} pid {{pid}}）。ログイン時の自動起動は未登録です', '서비스 실행 중 ({{kind}} pid {{pid}}). 로그인 시 자동 시작이 등록되지 않았습니다'],
  'service.desktopOwner': ['提示: 当前 runtime owner 是桌面端，本地采集由桌面负责', 'Note: Desktop currently owns collection and collects local data.', '注記: デスクトップが現在の収集担当です。', '참고: 현재 데스크톱에서 로컬 데이터 수집을 담당합니다.'],
  'service.observerHint': ['如需浏览器面板，可另开终端执行 quotern start（观察模式，只读）', 'For the browser dashboard, run quotern start in another terminal (observer mode, read only).', 'ブラウザのダッシュボードが必要なら、別の端末で quotern start を実行してください（閲覧モード、読取専用）。', '브라우저 대시보드가 필요하면 다른 터미널에서 quotern start를 실행하세요 (조회 모드, 읽기 전용).'],
  'service.startTimeout': ['自启已注册，但进程未及时启动（/health 也未就绪）。请查看 {{path}}', 'Login startup is registered, but the process and /health did not become ready in time. Check {{path}}.', '自動起動は登録されましたが、プロセスと /health が時間内に準備できませんでした。{{path}} を確認してください。', '자동 시작은 등록되었지만 프로세스와 /health가 시간 내에 준비되지 않았습니다. {{path}}를 확인하세요.'],
  'service.startedPid': ['✓ 服务已在后台启动 (pid {{pid}})', '✓ Service started in the background (pid {{pid}})', '✓ サービスをバックグラウンドで開始しました（pid {{pid}}）', '✓ 서비스가 백그라운드에서 시작되었습니다 (pid {{pid}})'],
  'service.startedHealth': ['✓ 服务已在后台启动（面板 /health 已就绪）', '✓ Service started in the background (dashboard /health is ready)', '✓ サービスをバックグラウンドで開始しました（/health 応答あり）', '✓ 서비스가 백그라운드에서 시작되었습니다 (대시보드 /health 준비됨)'],
  'service.autostart': ['开机自启: {{state}}', 'Login startup: {{state}}', 'ログイン時の自動起動: {{state}}', '로그인 시 자동 시작: {{state}}'],
  'service.registered': ['已注册', 'Registered', '登録済み', '등록됨'],
  'service.unregistered': ['未注册', 'Not registered', '未登録', '등록되지 않음'],
  'service.log': ['日志: {{path}}', 'Log: {{path}}', 'ログ: {{path}}', '로그: {{path}}'],
  'service.stopDesktop': ['✓ 开机自启已取消（当前 runtime owner 是桌面端 pid {{pid}}，未结束桌面进程）', '✓ Login startup removed. Desktop owns collection (pid {{pid}}) and remains running.', '✓ 自動起動を解除しました。デスクトップが収集担当（pid {{pid}}）で、実行は継続します。', '✓ 자동 시작을 해제했습니다. 데스크톱에서 수집 중이며 (pid {{pid}}) 계속 실행됩니다.'],
  'service.stopPidFailed': ['无法停止进程 pid {{pid}}', 'Could not stop process pid {{pid}}', 'プロセス pid {{pid}} を停止できませんでした', '프로세스 pid {{pid}}을 중지하지 못했습니다'],
  'service.stopped': ['✓ 服务已停止，开机自启已取消', '✓ Service stopped and login startup removed', '✓ サービスを停止し、自動起動を解除しました', '✓ 서비스를 중지하고 자동 시작을 해제했습니다'],
  'service.statusOwner': ['服务: 运行中（{{kind}} pid {{pid}}）', 'Service: running ({{kind}} pid {{pid}})', 'サービス: 実行中（{{kind}} pid {{pid}}）', '서비스: 실행 중 ({{kind}} pid {{pid}})'],
  'service.statusStopped': ['服务: 未运行', 'Service: not running', 'サービス: 停止中', '서비스: 실행 중 아님'],
  'doctor.title': ['系统环境与数据源全面诊断', 'System and data source diagnostics', 'システムとデータソースの診断', '시스템 및 데이터 소스 진단'],
  'doctor.time': ['诊断时间: {{date}}', 'Checked at: {{date}}', '診断時刻: {{date}}', '진단 시각: {{date}}'],
  'doctor.category.runtime': ['运行环境与进程状态', 'Runtime and processes', '実行環境とプロセス', '실행 환경 및 프로세스'],
  'doctor.category.storage': ['数据存储与权限', 'Storage and permissions', 'データ保存先と権限', '데이터 저장소 및 권한'],
  'doctor.category.collectors': ['本地 Agent 与数据源', 'Local agents and data sources', 'ローカル Agent とデータソース', '로컬 Agent 및 데이터 소스'],
  'doctor.item.runtime-node': ['Node.js 版本', 'Node.js version', 'Node.js バージョン', 'Node.js 버전'],
  'doctor.item.runtime-os': ['操作系统', 'Operating system', 'オペレーティングシステム', '운영 체제'],
  'doctor.item.runtime-pid': ['服务进程锁', 'Service process lock', 'サービスのプロセスロック', '서비스 프로세스 잠금'],
  'doctor.item.runtime-port': ['面板端口', 'Dashboard port', 'ダッシュボードのポート', '대시보드 포트'],
  'doctor.item.storage-datadir': ['数据目录', 'Data directory', 'データ保存先', '데이터 디렉터리'],
  'doctor.item.storage-config': ['配置文件', 'Configuration file', '設定ファイル', '설정 파일'],
  'doctor.item.storage-logs': ['日志目录', 'Log directory', 'ログ保存先', '로그 디렉터리'],
  'doctor.item.storage-cursors': ['同步游标', 'Sync cursors', '同期カーソル', '동기화 커서'],
  'doctor.item.collectors-summary': ['已探测 Agent', 'Detected agents', '検出した Agent', '감지된 Agent'],
  'doctor.message.runtime-node.ok': ['Node.js 版本符合要求。', 'Node.js version meets the requirement.', 'Node.js のバージョンは要件を満たしています。', 'Node.js 버전이 요구 사항을 충족합니다.'],
  'doctor.message.runtime-node.error': ['Node.js 版本过低，需要 20 或更高版本。', 'Node.js 20 or newer is required.', 'Node.js 20 以降が必要です。', 'Node.js 20 이상이 필요합니다.'],
  'doctor.message.runtime-pid.ok': ['本地采集服务正在运行。', 'Local collection is running.', 'ローカル収集サービスは実行中です。', '로컬 수집 서비스가 실행 중입니다.'],
  'doctor.message.runtime-pid.info': ['当前没有常驻采集服务，或失效的锁已清理。', 'No resident collector is running, or a stale lock was cleared.', '常駐の収集サービスは実行されていないか、古いロックを消去しました。', '상주 수집 서비스가 실행 중이지 않거나 오래된 잠금을 정리했습니다.'],
  'doctor.message.runtime-pid.warn': ['失效的进程锁未能自动清理。', 'A stale process lock could not be cleared automatically.', '古いプロセスロックを自動消去できませんでした。', '오래된 프로세스 잠금을 자동으로 정리하지 못했습니다.'],
  'doctor.message.runtime-port.ok': ['面板端口正在监听。', 'Dashboard port is listening.', 'ダッシュボードのポートは待受中です。', '대시보드 포트에서 수신 중입니다.'],
  'doctor.message.runtime-port.info': ['面板端口未在监听。', 'Dashboard port is not listening.', 'ダッシュボードのポートは待受していません。', '대시보드 포트에서 수신하지 않습니다.'],
  'doctor.message.storage-datadir.ok': ['数据目录可读写。', 'Data directory is readable and writable.', 'データ保存先は読み書きできます。', '데이터 디렉터리를 읽고 쓸 수 있습니다.'],
  'doctor.message.storage-datadir.error': ['无法访问数据目录。', 'Data directory cannot be accessed.', 'データ保存先にアクセスできません。', '데이터 디렉터리에 접근할 수 없습니다.'],
  'doctor.message.storage-config.ok': ['配置文件有效。', 'Configuration file is valid.', '設定ファイルは有効です。', '설정 파일이 유효합니다.'],
  'doctor.message.storage-config.warn': ['配置文件曾损坏，已自动恢复。请检查恢复后的配置。', 'config.json was damaged and recovered automatically. Review the restored configuration.', 'config.json の破損から自動復旧しました。復旧後の設定を確認してください。', 'config.json이 손상되었으나 자동 복구했습니다. 복구된 설정을 확인하세요.'],
  'doctor.message.storage-config.error': ['无法加载配置文件。', 'Configuration file could not be loaded.', '設定ファイルを読み込めませんでした。', '설정 파일을 불러오지 못했습니다.'],
  'doctor.message.storage-logs.ok': ['日志目录可写。', 'Log directory is writable.', 'ログ保存先に書き込めます。', '로그 디렉터리에 쓸 수 있습니다.'],
  'doctor.message.storage-logs.info': ['日志目录将在首次启动时创建。', 'Log directory will be created on first start.', 'ログ保存先は初回起動時に作成されます。', '로그 디렉터리는 처음 시작할 때 생성됩니다.'],
  'doctor.message.storage-logs.warn': ['日志目录权限异常。', 'Log directory permissions need attention.', 'ログ保存先の権限を確認してください。', '로그 디렉터리 권한을 확인해야 합니다.'],
  'doctor.message.storage-cursors.ok': ['同步游标记录有效。', 'Sync cursor records are valid.', '同期カーソルの記録は有効です。', '동기화 커서 기록이 유효합니다.'],
  'doctor.message.storage-cursors.info': ['尚无同步游标记录。', 'No sync cursor records yet.', '同期カーソルの記録はまだありません。', '동기화 커서 기록이 아직 없습니다.'],
  'doctor.message.storage-cursors.warn': ['同步游标文件无法解析。', 'Sync cursor file could not be parsed.', '同期カーソルのファイルを解析できませんでした。', '동기화 커서 파일을 파싱하지 못했습니다.'],
  'doctor.message.collectors-summary.ok': ['检测到 {{count}} 个本地 Agent 数据源。', 'Detected {{count}} local agent data source(s).', 'ローカル Agent のデータソースを {{count}} 件検出しました。', '로컬 Agent 데이터 소스 {{count}}개를 감지했습니다.'],
  'doctor.message.collectors-summary.warn': ['没有检测到受支持的 Agent 日志或数据库。', 'No supported agent logs or databases were detected.', '対応する Agent のログまたはデータベースを検出できませんでした。', '지원되는 Agent 로그 또는 데이터베이스를 감지하지 못했습니다.'],
  'doctor.message.generic.ok': ['检查通过。', 'Check passed.', '検査に合格しました。', '검사를 통과했습니다.'],
  'doctor.message.generic.info': ['请查看诊断状态。', 'See diagnostic status.', '診断状態を確認してください。', '진단 상태를 확인하세요.'],
  'doctor.message.generic.warn': ['此项需要检查。', 'This item needs attention.', 'この項目を確認してください。', '이 항목을 확인해야 합니다.'],
  'doctor.message.generic.error': ['此项检查失败。', 'This check failed.', 'この項目の検査に失敗しました。', '이 항목의 검사가 실패했습니다.'],
  'doctor.collectorDetails': ['Coding Agent 探测详情（{{detected}} / {{total}} 款已就绪）', 'Coding Agent detection ({{detected}} / {{total}} ready)', 'Coding Agent の検出（{{detected}} / {{total}} 準備済み）', 'Coding Agent 감지 ({{detected}} / {{total}}개 준비됨)'],
  'doctor.noneDetected': ['尚未检测到任何支持的 Agent', 'No supported agents detected', '対応する Agent は検出されませんでした', '지원되는 Agent를 감지하지 못했습니다'],
  'doctor.hookActive': ['Hook: 已启用', 'Hook: active', 'Hook: 有効', 'Hook: 활성'],
  'doctor.hookInactive': ['Hook: 未启用', 'Hook: inactive', 'Hook: 無効', 'Hook: 비활성'],
  'doctor.undetected': ['未探测到日志的 Agent（{{count}}）: {{names}}', 'Agents without detected logs ({{count}}): {{names}}', 'ログを検出できなかった Agent（{{count}}）: {{names}}', '로그가 감지되지 않은 Agent ({{count}}개): {{names}}'],
  'doctor.suggestions': ['诊断发现以下建议项:', 'Suggested actions:', '推奨される対応:', '권장 조치:'],
  'doctor.suggestion.runtime-node': ['请将 Node.js 升级至 20 或更高版本。', 'Upgrade Node.js to version 20 or newer.', 'Node.js を 20 以降に更新してください。', 'Node.js를 20 이상으로 업그레이드하세요.'],
  'doctor.suggestion.runtime-pid': ['请检查并清理陈旧的进程锁。', 'Inspect and remove the stale process lock.', '古いプロセスロックを確認して削除してください。', '오래된 프로세스 잠금을 확인하고 제거하세요.'],
  'doctor.suggestion.storage-datadir': ['请检查数据目录的读写权限。', 'Check read and write permissions for the data directory.', 'データ保存先の読み書き権限を確認してください。', '데이터 디렉터리의 읽기 및 쓰기 권한을 확인하세요.'],
  'doctor.suggestion.storage-config': ['请检查配置文件及其备份。', 'Review the configuration file and its backup.', '設定ファイルとバックアップを確認してください。', '설정 파일과 백업을 확인하세요.'],
  'doctor.suggestion.storage-logs': ['请检查日志目录的写入权限。', 'Check write permissions for the log directory.', 'ログ保存先の書込権限を確認してください。', '로그 디렉터리의 쓰기 권한을 확인하세요.'],
  'doctor.suggestion.storage-cursors': ['请运行 quotern sync 修复游标记录。', 'Run quotern sync to rebuild cursor records.', 'quotern sync を実行してカーソルの記録を修復してください。', 'quotern sync를 실행해 커서 기록을 복구하세요.'],
  'doctor.suggestion.collectors-summary': ['请确认受支持的 Agent 已产生本地用量数据。', 'Check that a supported agent has produced local usage data.', '対応する Agent がローカル使用量を記録済みか確認してください。', '지원되는 Agent가 로컬 사용량 데이터를 생성했는지 확인하세요.'],
  'doctor.summary.ok': ['🎉 诊断完成: {{ok}} 项正常，0 个错误，0 个警告。', '🎉 Diagnostics complete: {{ok}} checks passed, no errors or warnings.', '🎉 診断完了: {{ok}} 件正常、エラーと警告はありません。', '🎉 진단 완료: {{ok}}개 항목 정상, 오류 및 경고 없음.'],
  'doctor.summary.warn': ['⚠️ 诊断完成: {{warn}} 个提醒事项，请查看上方建议。', '⚠️ Diagnostics complete: {{warn}} item(s) need attention. See suggestions above.', '⚠️ 診断完了: {{warn}} 件の注意事項があります。上の推奨対応を確認してください。', '⚠️ 진단 완료: {{warn}}개 항목에 주의가 필요합니다. 위의 권장 조치를 확인하세요.'],
  'doctor.summary.error': ['❌ 诊断完成: {{error}} 个异常项，请优先处理上方错误。', '❌ Diagnostics complete: {{error}} error(s). Address the errors above first.', '❌ 診断完了: {{error}} 件のエラーがあります。上のエラーから対処してください。', '❌ 진단 완료: {{error}}개 오류. 위의 오류를 먼저 해결하세요.'],
  'usage.missing': ['{{option}} 缺少参数值', '{{option}} requires a value', '{{option}} に値が必要です', '{{option}}에 값이 필요합니다'],
  'usage.empty': ['{{option}} 参数不能为空', '{{option}} cannot be empty', '{{option}} を空にできません', '{{option}}는 비워 둘 수 없습니다'],
  'usage.daysRange': ['--days 必须是 1 到 3660 之间的整数: {{value}}', '--days must be an integer from 1 to 3660: {{value}}', '--days は 1 から 3660 の整数にしてください: {{value}}', '--days는 1부터 3660까지의 정수여야 합니다: {{value}}'],
  'usage.dateInvalid': ['{{option}} 日期必须使用真实的 YYYY-MM-DD 日期: {{value}}', '{{option}} must be a valid YYYY-MM-DD date: {{value}}', '{{option}} には有効な YYYY-MM-DD 日付を指定してください: {{value}}', '{{option}}에는 유효한 YYYY-MM-DD 날짜를 지정하세요: {{value}}'],
  'usage.sourceEmpty': ['--source 参数不能为空，多个数据源请用逗号分隔', '--source cannot be empty; separate multiple sources with commas', '--source を空にできません。複数のソースはカンマで区切ってください', '--source는 비워 둘 수 없습니다. 여러 소스는 쉼표로 구분하세요'],
  'usage.sourceAllMixed': ['--source 的 all 不能与其他数据源混合', '--source all cannot be combined with other sources', '--source の all と他のデータソースは併用できません', '--source의 all은 다른 데이터 소스와 함께 사용할 수 없습니다'],
  'usage.duplicate': ['{{option}} 参数重复', '{{option}} was specified more than once', '{{option}} が重複しています', '{{option}} 옵션이 중복되었습니다'],
  'usage.formatConflict': ['格式参数互相冲突: {{first}} 与 {{second}}', 'Conflicting format options: {{first}} and {{second}}', '出力形式の指定が競合しています: {{first}} と {{second}}', '출력 형식 옵션이 충돌합니다: {{first}} 및 {{second}}'],
  'usage.formatInvalid': ['--format 仅支持 text、json 或 csv: {{value}}', '--format supports only text, json or csv: {{value}}', '--format は text、json、csv のみ対応します: {{value}}', '--format은 text, json, csv만 지원합니다: {{value}}'],
  'usage.unknownOption': ['未知参数: {{value}}', 'Unknown option: {{value}}', '不明なオプション: {{value}}', '알 수 없는 옵션: {{value}}'],
  'usage.extraArgument': ['多余的位置参数: {{value}}', 'Unexpected positional argument: {{value}}', '余分な位置引数: {{value}}', '예상치 못한 위치 인수: {{value}}'],
  'usage.unknownPeriod': ['未知 usage 周期: {{value}}；可用值: {{periods}}', 'Unknown usage period: {{value}}; available: {{periods}}', '不明な usage 集計期間: {{value}}。使用可能: {{periods}}', '알 수 없는 usage 기간: {{value}}. 사용 가능: {{periods}}'],
  'usage.rangePair': ['--from 和 --to 必须同时提供', '--from and --to must be provided together', '--from と --to は両方指定してください', '--from과 --to를 함께 지정해야 합니다'],
  'usage.rangeOrder': ['--from 不能晚于 --to', '--from cannot be later than --to', '--from は --to より後にできません', '--from은 --to보다 늦을 수 없습니다'],
  'usage.rangeDays': ['--from/--to 日期范围不能与显式 --days 同时使用', '--from/--to cannot be combined with --days', '--from/--to と --days は併用できません', '--from/--to와 --days는 함께 사용할 수 없습니다'],
  'usage.compactJson': ['--compact 仅支持 JSON 输出，请同时指定 --format json 或 --json', '--compact requires JSON output; use --format json or --json', '--compact は JSON 出力専用です。--format json または --json を指定してください', '--compact는 JSON 출력에서만 사용할 수 있습니다. --format json 또는 --json을 지정하세요'],
  'report.title': ['Quotern 用量 · {{period}}', 'Quotern usage · {{period}}', 'Quotern 使用量 · {{period}}', 'Quotern 사용량 · {{period}}'],
  'report.period.summary': ['汇总', 'summary', '概要', '요약'],
  'report.period.overview': ['综合概览', 'overview', '総合概要', '종합 개요'],
  'report.period.daily': ['每日', 'daily', '日別', '일별'],
  'report.period.weekly': ['每周', 'weekly', '週別', '주별'],
  'report.period.monthly': ['每月', 'monthly', '月別', '월별'],
  'report.period.models': ['模型', 'models', 'モデル', '모델'],
  'report.period.projects': ['项目', 'projects', 'プロジェクト', '프로젝트'],
  'report.unknown': ['未知', 'Unknown', '不明', '알 수 없음'],
  'report.unknownCost': ['未知（已知 {{known}}）', 'Unknown (known {{known}})', '不明（判明分 {{known}}）', '알 수 없음 (확인된 금액 {{known}})'],
  'report.reportedCost': ['来源报告费用', 'Reported cost', 'ソース報告の費用', '원본 보고 비용'],
  'report.estimatedCost': ['按费率估算费用', 'Rate-estimated cost', '料金表による推定費用', '요율 기준 추정 비용'],
  'report.unpricedTokens': ['未定价 tokens', 'Unpriced tokens', '料金未設定の tokens', '가격 미지정 tokens'],
  'report.defaultPricedTokens': ['默认费率 tokens', 'Default-rate tokens', '既定料金の tokens', '기본 요율 tokens'],
  'report.quality.recorded': ['记录值', 'Recorded', '記録値', '기록값'],
  'report.quality.estimated': ['估算值', 'Estimated', '推定値', '추정값'],
  'report.quality.ledger': ['账本值', 'Ledger', '台帳値', '원장값'],
  'report.quality.mixed': ['混合值', 'Mixed', '混合値', '혼합값'],
  'report.quality.unknown': ['未知值', 'Unknown', '不明', '알 수 없음'],
  'report.coverage': ['覆盖起点', 'Coverage starts', '収集開始', '수집 시작'],
  'report.limited': ['范围受限', 'limited', '範囲制限あり', '범위 제한'],
  'report.complete': ['范围完整', 'complete', '範囲制限なし', '범위 제한 없음'],
  'report.lastSync': ['最近同步完成', 'Last sync', '最終同期', '마지막 동기화'],
  'report.readAt': ['报告读取时间', 'Report read at', 'レポート読込時刻', '보고서 읽은 시각'],
  'report.snapshot': ['快照', 'Snapshot', 'スナップショット', '스냅샷'],
  'report.snapshotPersisted': ['persisted（读取时已落盘快照）', 'Persisted (snapshot was on disk when read)', '保存済み（読込時にディスク上に存在）', '저장됨 (읽을 때 디스크에 있던 스냅샷)'],
  'report.snapshotRuntime': ['runtime（当前运行时快照）', 'Runtime (current in-memory snapshot)', '実行時（現在のメモリ内スナップショット）', '실행 중 (현재 메모리 스냅샷)'],
  'report.tip': ['提示', 'Note', '注記', '참고'],
  'report.syncCaveat': ['最近同步完成时间不代表所有来源的数据均已更新至此时。', 'The last sync time does not mean every source is current through that time.', '最終同期時刻は、すべてのソースがその時刻まで更新済みであることを意味しません。', '마지막 동기화 시각이 모든 소스의 데이터가 그 시각까지 최신임을 뜻하지는 않습니다.'],
  'report.costCaveat': ['费用信息包含来源报告与费率估算，不是实际账单。', 'Costs include source reports and rate estimates; they are not an actual bill.', '費用にはソースの報告値と料金表による推定値が含まれます。実際の請求額ではありません。', '비용에는 원본 보고값과 요율 추정값이 포함됩니다. 실제 청구액이 아닙니다.'],
  'help.full': [
    `Usage: quotern <command> [options]

Commands:
  start                 前台启动本地面板与同步（默认；桌面已运行时为观察模式）
  stop                  停止当前进程内的服务
  status                查看 CLI / 面板当前启动状态
  sync                  手动同步本地用量数据
  usage [summary|overview|daily|weekly|monthly|models|projects]
                        查询已落盘的本地用量数据（只读，不触发同步）
  statusline            从 stdin 读取 Claude 状态并显示会话费用、今日估价与上下文
  service <action>      后台服务与开机自启（macOS / Windows / Linux）
                        action: start | stop | status
  doctor                诊断系统环境与本地数据源
  help                  显示帮助

Options:
  --lang <zh-CN|en|ja|ko> 输出语言（默认跟随系统）
  --port <number>       面板端口（默认 {{port}}）
  --host <address>      面板监听地址（默认 {{host}}；局域网访问用 0.0.0.0）
  --source <name>       sync 数据源：{{sources}}
  usage 选项：
    --days <1..3660>     查询最近 N 天
    --from <YYYY-MM-DD>  日期范围起始日期（须与 --to 同时使用）
    --to <YYYY-MM-DD>    日期范围结束日期（须与 --from 同时使用）
    --source <names>     按数据源筛选，支持逗号分隔与重复值去重
    --model <name>       按模型筛选
    --project <name>     按项目筛选
    --data-dir <path>    指定本地用量数据目录
    --format <text|json|csv> 选择输出格式；--json / --csv 为快捷方式
    --compact           精简 JSON（须配合 --json）：保留分组总量及质量提示，省略逐条价格明细
  -h, --help            显示帮助

Examples:
  quotern
  quotern start --port 8252
  quotern start --host 0.0.0.0
  quotern status
  quotern usage
  quotern usage daily --days 30 --source claude,codex
  quotern usage --from 2026-03-01 --to 2026-03-07 --format json
  quotern usage models --days 7 --format json --compact
  quotern usage models --csv --model claude-3-7-sonnet
  quotern sync --source=claude
  quotern service start`,
    `Usage: quotern <command> [options]

Commands:
  start                 Start the local dashboard and sync in the foreground (default; observer mode if Desktop is running)
  stop                  Stop the service in this process
  status                Show current CLI and dashboard status
  sync                  Sync local usage data manually
  usage [summary|overview|daily|weekly|monthly|models|projects]
                        Query persisted local usage (read only; does not sync)
  statusline            Show Claude session cost, local daily estimate and context from stdin
  service <action>      Background service and login startup (macOS / Windows / Linux)
                        action: start | stop | status
  doctor                Diagnose the system and local data sources
  help                  Show this help

Options:
  --lang <zh-CN|en|ja|ko> Output language (default: system language)
  --port <number>       Dashboard port (default {{port}})
  --host <address>      Listen address (default {{host}}; use 0.0.0.0 for LAN access)
  --source <name>       Sync source: {{sources}}
  usage options:
    --days <1..3660>     Query the most recent N days
    --from <YYYY-MM-DD>  Start date (use together with --to)
    --to <YYYY-MM-DD>    End date (use together with --from)
    --source <names>     Filter sources; comma separated, duplicates removed
    --model <name>       Filter model
    --project <name>     Filter project
    --data-dir <path>    Local usage data directory
    --format <text|json|csv> Output format; --json / --csv are shortcuts
    --compact           Compact JSON (requires --json); omit detailed price entries
  -h, --help            Show this help

Examples:
  quotern
  quotern start --port 8252
  quotern start --host 0.0.0.0
  quotern status
  quotern usage
  quotern usage daily --days 30 --source claude,codex
  quotern usage --from 2026-03-01 --to 2026-03-07 --format json
  quotern usage models --days 7 --format json --compact
  quotern usage models --csv --model claude-3-7-sonnet
  quotern sync --source=claude
  quotern service start`,
    `使い方: quotern <command> [options]

コマンド:
  start                 ローカルダッシュボードと同期を前面で開始（既定。Desktop 実行中は閲覧モード）
  stop                  このプロセス内のサービスを停止
  status                CLI とダッシュボードの状態を表示
  sync                  ローカル使用量を手動で同期
  usage [summary|overview|daily|weekly|monthly|models|projects]
                        保存済みの使用量を参照（読取専用。同期は行いません）
  statusline            stdin の Claude 状態から費用とコンテキストを表示
  service <action>      バックグラウンドサービスとログイン時の自動起動
                        action: start | stop | status
  doctor                システムとローカルデータソースを診断
  help                  ヘルプを表示

オプション:
  --lang <zh-CN|en|ja|ko> 出力言語（既定はシステム言語）
  --port <number>       ダッシュボードのポート（既定 {{port}}）
  --host <address>      待受アドレス（既定 {{host}}。LAN 公開は 0.0.0.0）
  --source <name>       同期するデータソース: {{sources}}
  usage オプション:
    --days <1..3660>     最近 N 日間を照会
    --from <YYYY-MM-DD>  開始日（--to と併用）
    --to <YYYY-MM-DD>    終了日（--from と併用）
    --source <names>     ソースを絞り込み（カンマ区切り、重複除去）
    --model <name>       モデルを絞り込み
    --project <name>     プロジェクトを絞り込み
    --data-dir <path>    ローカルデータの保存先
    --format <text|json|csv> 出力形式。--json / --csv は短縮形
    --compact           簡略 JSON（--json が必要）。価格の詳細を省略
  -h, --help            ヘルプを表示

例:
  quotern
  quotern start --port 8252
  quotern start --host 0.0.0.0
  quotern status
  quotern usage
  quotern usage daily --days 30 --source claude,codex
  quotern usage --from 2026-03-01 --to 2026-03-07 --format json
  quotern usage models --days 7 --format json --compact
  quotern usage models --csv --model claude-3-7-sonnet
  quotern sync --source=claude
  quotern service start`,
    `사용법: quotern <command> [options]

명령:
  start                 로컬 대시보드와 동기화를 전경에서 시작 (기본값, Desktop 실행 중에는 조회 모드)
  stop                  이 프로세스의 서비스를 중지
  status                CLI 및 대시보드 상태 표시
  sync                  로컬 사용량을 수동 동기화
  usage [summary|overview|daily|weekly|monthly|models|projects]
                        저장된 로컬 사용량 조회 (읽기 전용, 동기화하지 않음)
  statusline            stdin의 Claude 상태로 비용 및 컨텍스트 표시
  service <action>      백그라운드 서비스 및 로그인 시 자동 시작
                        action: start | stop | status
  doctor                시스템 및 로컬 데이터 소스 진단
  help                  도움말 표시

옵션:
  --lang <zh-CN|en|ja|ko> 출력 언어 (기본값: 시스템 언어)
  --port <number>       대시보드 포트 (기본값 {{port}})
  --host <address>      수신 주소 (기본값 {{host}}. LAN 접속에는 0.0.0.0 사용)
  --source <name>       동기화 데이터 소스: {{sources}}
  usage 옵션:
    --days <1..3660>     최근 N일 조회
    --from <YYYY-MM-DD>  시작 날짜 (--to와 함께 사용)
    --to <YYYY-MM-DD>    종료 날짜 (--from과 함께 사용)
    --source <names>     소스 필터 (쉼표 구분, 중복 제거)
    --model <name>       모델 필터
    --project <name>     프로젝트 필터
    --data-dir <path>    로컬 사용량 데이터 디렉터리
    --format <text|json|csv> 출력 형식. --json / --csv는 단축 옵션
    --compact           간결한 JSON (--json 필요). 가격 상세 내역 생략
  -h, --help            도움말 표시

예:
  quotern
  quotern start --port 8252
  quotern start --host 0.0.0.0
  quotern status
  quotern usage
  quotern usage daily --days 30 --source claude,codex
  quotern usage --from 2026-03-01 --to 2026-03-07 --format json
  quotern usage models --days 7 --format json --compact
  quotern usage models --csv --model claude-3-7-sonnet
  quotern sync --source=claude
  quotern service start`,
  ],
};

const locales: SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ko'];
export const cliMessages: Record<SupportedLocale, Record<string, string>> = {
  'zh-CN': {}, en: {}, ja: {}, ko: {},
};
for (const [key, translations] of Object.entries(entries)) {
  locales.forEach((locale, index) => {
    cliMessages[locale][`cli.${key}`] = translations[index];
  });
}
