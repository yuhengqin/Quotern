<h1 align="center">Quotern</h1>

<p align="center">
  <a href="./README.en.md">English</a> · <a href="./README.md">简体中文</a> · <strong>日本語</strong> · <a href="./README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="./apps/desktop/resources/icon.png" alt="Quotern ロゴ" width="200">
</p>

<p align="center">
  <strong>AI の利用状況を、ひと目で把握。</strong><br>
  Coding Agent の Token、サブスクリプション枠、推定費用、セッション記録をまとめて確認できます。
</p>

<p align="center">
  <a href="https://github.com/yuhengqin/Quotern">
    <img src="https://img.shields.io/github/stars/yuhengqin/Quotern?style=flat-square" alt="stars">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/issues">
    <img src="https://img.shields.io/github/issues/yuhengqin/Quotern?style=flat-square" alt="issues">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/releases">
    <img src="https://img.shields.io/github/downloads/yuhengqin/Quotern/total?style=flat-square" alt="downloads">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/releases/latest">
    <img src="https://img.shields.io/github/v/release/yuhengqin/Quotern?include_prereleases&style=flat-square" alt="release">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/commits/main">
    <img src="https://img.shields.io/github/last-commit/yuhengqin/Quotern?style=flat-square" alt="last-commit">
  </a>
</p>

<p align="center">
  <a href="https://github.com/yuhengqin/Quotern/releases">インストーラーをダウンロード</a>
  ·
  <a href="#quick-start">クイックスタート</a>
  ·
  <a href="#feature-preview">機能プレビュー</a>
  ·
  <a href="./FAQ.md">よくある質問</a>
  ·
  <a href="#agent-integration">Agent の自動検出と呼び出し</a>
  ·
  <a href="#local-data">ローカルデータ</a>
</p>

Claude Code、Codex、Cursor、Gemini CLI など複数の AI コーディングツールの利用状況を集約し、1 つのパネルで推移、モデル、プロジェクト別の内訳を確認できます。macOS / Windows のデスクトップアプリに対応し、CLI を使えば macOS / Windows / Linux のローカルブラウザでパネルを開けます。

<p align="center">
  <img src="./assets/usage-dashboard.png" alt="Quotern の利用状況概要：Token、推定費用、サブスクリプション枠、アクティビティヒートマップ" width="960">
</p>

<a id="quick-start"></a>

## ⚡ クイックスタート

### 🖥️ デスクトップアプリを使う

Quotern は macOS / Windows 向けのデスクトップアプリを提供しており、インストール後すぐに使えます。追加設定は不要です。

#### ダウンロードとインストール

[Releases](https://github.com/yuhengqin/Quotern/releases) ページから、お使いのシステムとアーキテクチャに合ったインストーラーをダウンロードしてください。

| システム / チップ | インストーラー | その他のダウンロード |
| --- | --- | --- |
| macOS Apple Silicon | `Quotern-<version>-mac-arm64.dmg` | 同名の `.zip` |
| macOS Intel | `Quotern-<version>-mac-x64.dmg` | 同名の `.zip` |
| Windows x64 | `Quotern-<version>-win-x64-setup.exe` | `*-win-x64-portable.exe` ポータブル版 |
| Windows ARM64 | `Quotern-<version>-win-arm64-setup.exe` | `*-win-arm64-portable.exe` ポータブル版 |

上記は新しいリリース手順での命名規則です。旧バージョンでは添付ファイル名が異なる場合があります。macOS 版は現在、デフォルトで ad-hoc 署名を使用し、Apple 公証を省略しています。アプリ内にダウンロードページへのリンクがあり、新しいバージョンは手動でダウンロードしてアプリを置き換える必要があります。初回起動時に Gatekeeper によってブロックされることがあります。本プロジェクトからのダウンロードであることを確認し、Release のチェックサムファイルを照合したうえで、[Apple の公式案内](https://support.apple.com/en-us/102445)に従い「システム設定 → プライバシーとセキュリティ」で「このまま開く」オプションを確認してください。正式な Developer ID 署名と公証を使うビルドモードも引き続き利用できます。実際のビルドモードは Release の説明と検証レポートを確認してください。

Release の **Source code** は該当 tag のソースコードスナップショットです。ビルド方法は[ソースアーカイブからのビルド手順](./CONTRIBUTING.md#从-source-code-归档构建)を参照してください。

#### 初回起動

1. **Quotern** アプリを開きます。
2. 初回起動時に Claude / Codex Hook の登録を自動的に試み、ローカルの利用状況を同期します。
3. パネルが自動的に開き、利用状況の推移やモデル別の内訳などが表示されます。

Claude / Codex などの Agent が検出されない場合は、インストール済みで、少なくとも一度は使用したことを確認してください。

利用状況データはローカルに保存され、パネルはローカルの集計データを直接読み込みます。

### ⌨️ CLI を使う

Node.js >= 20.10 が必要です。macOS / Windows / Linux では、事前にグローバルインストールしなくても `npx` でフォアグラウンド起動できます。

```bash
npx quotern
# パネル: http://127.0.0.1:8252
# 停止するには Ctrl+C
```

継続して使う場合はグローバルインストールし、バックグラウンドサービスとして起動できます（システム起動時の自動起動にも対応）。

```bash
npm i -g quotern
quotern service start
# パネル: http://127.0.0.1:8252
```

中国国内のネットワークで接続が遅い場合は、`npm i -g quotern --registry=https://registry.npmmirror.com/` を使用できます。コマンド、オプション、データの詳細は [CLI の使い方](./CLI.md)を参照してください。

よく使うコマンド：

```bash
quotern status           # 実行状態を確認
quotern sync             # ローカルの利用状況を手動で同期
quotern doctor           # 環境とデータソースを確認
quotern usage --days 7   # 直近 7 日間の利用状況を照会
```

Windows で初めて起動時の自動実行を登録するには、管理者権限が必要です。Linux のバックグラウンドサービスには systemd のユーザーインスタンスが必要です。`quotern start` でフォアグラウンド起動できます。詳しくは [CLI クイックスタート](./CLI.md#快速开始)を参照してください。

## ✨ 特長

- **複数 Agent の利用状況を一元集計**：複数のコーディングツールのローカルログやデータベースを集約し、Agent、モデル、プロジェクト別に消費量を確認できます。
- **利用状況の推移とアクティビティヒートマップ**：今日、直近 24 時間、7 / 30 / 90 日、または任意の期間に切り替えて、入力、出力、キャッシュ、費用の推移を確認できます。
- **サブスクリプション枠の監視**：接続済みサービスの残り枠、利用ウィンドウ、リセット時刻をまとめて確認でき、ログイン失効などの読み取り状態も表示します。
- **セッションの追跡**：収集済みセッションを検索、絞り込み、並べ替えできます。詳細を展開してモデルの利用量、キャッシュ、費用の根拠、タスク所要時間を確認できます。
- **モデル価格の照会**：モデル料金を調べ、利用シーンごとの費用を推定してモデル間で比較できます。価格カタログは [models.dev](https://models.dev) から更新されます。
- **実績と共有カード**：利用日数、連続利用、個人の実績を記録し、選択した期間の利用状況をダウンロードまたはコピー可能な共有カードにできます。
- **デスクトップ概要とペット**：コンパクトな概要で主要な数値を確認できます。設定からデスクトップペットを選び、プレビューしてサイズを調整できます。
- **Agent から直接照会**：`quotern-usage` Skill を自然言語で使ってローカル集計を照会できます。JSON / CSV レポートと HTML の利用状況概要に対応しています。

費用は、データソースが報告した金額、モデル料金に基づく推定、価格不明の状態を区別して表示します。実際の支払い請求額として扱うことはできません。セッション、メッセージ、タスク所要時間の収集範囲はデータソースごとに異なるため、画面に表示される収集範囲の案内を確認してください。

<a id="feature-preview"></a>

## 🖼️ 機能プレビュー

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>セッションと利用状況の推移</strong><br>
      最近のセッションから利用記録を追跡し、Token 総量と入力、キャッシュ、出力の変化を時系列で確認できます。<br><br>
      <img src="./assets/sessions-and-usage-trends.png" alt="最近のセッション一覧、Token 総量の折れ線グラフ、利用内訳の棒グラフ" width="100%">
    </td>
    <td width="50%" valign="top">
      <strong>Agent、モデル、プロジェクト別の内訳</strong><br>
      利用量のランキングと分布を確認し、どのツール、モデル、プロジェクトが主な消費元かを把握できます。<br><br>
      <img src="./assets/usage-breakdown.png" alt="Agent とモデルの利用量ランキング、およびプロジェクト、Agent、モデル別の分布グラフ" width="100%">
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <strong>セッションブラウザー</strong><br>
      Agent とプロジェクトで絞り込み、セッションを検索して並べ替えられます。詳細を展開すると、モデル、入力 / 出力 Token、キャッシュ、費用の内訳を確認できます。<br><br>
      <img src="./assets/session-browser.png" alt="検索、絞り込み、ページ送り、詳細表示に対応したセッションブラウザー" width="100%">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>実績ショーケース</strong><br>
      バッジ、連続利用の記録、段階的に達成する目標で利用の軌跡を残せます。<br><br>
      <img src="./assets/achievements.png" alt="実績ショーケース、累計アクティブ日数、獲得済みバッジ、達成間近の目標" width="100%">
    </td>
    <td width="50%" valign="top">
      <strong>利用状況の共有カード</strong><br>
      期間と Agent を選択し、Token、推定費用、モデルランキングを含む共有カードを作成できます。<br><br>
      <img src="./assets/usage-share-card.png" alt="利用状況の共有カードのプレビュー。期間の絞り込み、モデルランキング、ダウンロードとコピーの操作を含む" width="100%">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>コンパクトな利用状況概要</strong><br>
      小さなウィンドウで、利用枠、主要な利用状況、直近の同期状態をすばやく確認できます。<br><br>
      <img src="./assets/compact-usage-overview.png" alt="サブスクリプション枠、利用状況、同期状態を表示するダークテーマのコンパクト概要ウィンドウ" width="300">
    </td>
    <td width="50%" valign="top">
      <strong>デスクトップペット</strong><br>
      キャラクターを選んで外観をプレビューし、サイズを調整してから現在のペットとして適用できます。<br><br>
      <img src="./assets/desktop-pet-settings.png" alt="ペット設定：現在のペットは Clawd、プレビュー中は大肥鱼。サイズを調整するか、選択を適用できます" width="100%">
    </td>
  </tr>
</table>

<details>
<summary>ワイド画面の利用状況概要を見る</summary>

![統計カード、サブスクリプション枠、年間アクティビティヒートマップ、最近のセッションを含むワイド画面の利用状況概要](./assets/usage-dashboard-wide.png)

</details>

## 🔌 データソースと対応範囲

| 機能 | 対応ソースの例 | 説明 |
| --- | --- | --- |
| Token と費用の集計 | Claude Code、Codex、Cursor、Gemini CLI、OpenCode、GitHub Copilot、DeepSeek Harness、ZCode など | 各ツールが提供するログ、データベース、請求データに基づきます。取得できる項目と履歴の範囲はソースによって異なります |
| サブスクリプション枠 | Codex、Claude、Cursor、Copilot、Grok、Kimi、ZCode、Antigravity、Qoder、MiniMax、OpenCode、DeepSeek | 各サービスの有効なログイン状態または設定が必要です。表示できる利用ウィンドウはアカウントのプランによって異なります |
| セッションとタスクの集計 | Claude Code、Codex、Gemini CLI、OpenCode、Copilot、pi、OMP、DeepSeek Harness、Antigravity、ZCode、Kimi | セッションと Token の収集範囲は個別に計算します。欠落や不完全なソースには収集範囲の案内が表示されます |

その他の利用状況ソースには、OpenClaw、AutoClaw、Hermes、Roo Code、Droid、Kiro、Cline、Amp、Qwen Code、CodeBuddy、WorkBuddy、Grok Build、Mimo、Every Code、Kilo CLI、Kilo Code、Goose、Zed、Warp、WPS Comate、Command Code、MiniMax Code、KinetAios があります。対応ツールの全一覧は [Core のデータソース定義](./packages/core/src/tool-catalog.ts)を参照してください。

利用状況の収集、サブスクリプション枠、セッション詳細には、それぞれ独立したデータ収集範囲があります。設定と集計方法は[データ収集と集計](./docs/data-notes.md)、[サブスクリプションデータの説明](./docs/subscription-plan-design.md)、[利用枠の管理](./docs/quota-management.md)を参照してください。

<a id="agent-integration"></a>

## Agent の自動検出と呼び出し

Quotern は [quotern-usage Skill](./packages/cli/skills/quotern-usage/SKILL.md) を提供しています。Agent Skills に対応した Coding Agent は、利用状況に関する質問に応じて Skill を自動で選択し、ローカルの照会を実行できます。照会には、利用可能な Quotern CLI と同期済みのローカルデータが必要です。デスクトップアプリのみをインストールしている場合は、CLI も別途インストールしてください。

### 推奨：npx skills でインストール

[Vercel Skills CLI](https://github.com/vercel-labs/skills) を使ってインストールします。現在のインストーラーには Node.js >= 22.20 が必要です。Quotern CLI 自体は引き続き Node.js >= 20.10 に対応しています。

```bash
npx skills add yuhengqin/Quotern --skill quotern-usage --full-depth --global
```

プロンプトに従ってインストール先の Agent を選びます。リンクモードを推奨します。Skill は `~/.agents/skills/quotern-usage/` にまとめて保存され、個別のディレクトリが必要な Agent にはインストーラーがリンクを作成します。Windows ではディレクトリジャンクション（Junction）を使用します。リンクを作成できない場合はコピー方式を選択できます。`--global` は個人のすべてのプロジェクトで使用できることを意味します。現在のプロジェクトだけで使う場合は、このオプションを外してください。

インストール前に、リポジトリ内で検出可能な Skill だけを確認することもできます。

```bash
npx skills add yuhengqin/Quotern --list --full-depth
```

このリポジトリのソースからインストールする場合は、リポジトリのルートディレクトリで `npx skills add ./packages/cli/skills/quotern-usage --global` を実行してください。リモートへのアクセスに失敗した場合は、まず GitHub リポジトリへのアクセス権を確認するか、チェックアウト済みのローカルソースを使用してください。

### Agent にインストールを依頼する

以下の文章を現在の Coding Agent に送り、[Agent のインストール手順](./README_AI.md)に従ってインストールし、検証結果を報告するよう依頼してください。

```text
https://github.com/yuhengqin/Quotern/blob/main/README_AI.md を読んでください。
既存のローカルカスタマイズを保持したまま、quotern-usage Skill を現在の Agent にグローバルインストールし、
ファイル一式、Skill の検出パス、Quotern CLI が利用可能であることを検証してください。
```

### 手動コピー（予備の方法）

インストーラーを利用できない場合は、インストール済みの CLI npm パッケージまたはこのリポジトリから `quotern-usage` フォルダー全体をコピーし、`references/`、`scripts/`、`assets/` を保持してください。以下では、現在のプロジェクトの `.agents/skills/` を例にしています。他の Skill ディレクトリを使う場合は、使用する Agent の要件に合わせて変更してください。CLI をグローバルインストールしても、Skill は自動的に Agent へ登録されません。

<details>
<summary>手動コピー用コマンドを見る</summary>

macOS / Linux：

```bash
mkdir -p .agents/skills
cp -R "$(npm root -g)/quotern/skills/quotern-usage" .agents/skills/
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force .agents/skills | Out-Null
Copy-Item -Recurse (Join-Path (npm root -g) 'quotern/skills/quotern-usage') .agents/skills/
```

このリポジトリの [`packages/cli/skills/quotern-usage`](./packages/cli/skills/quotern-usage/) からフォルダー全体をコピーすることもできます。

</details>

### Agent から照会する

使用する Agent の方法で Skill を再読み込みするか、セッションを開き直し、`quotern-usage` が読み込まれたことを確認してから、次のように質問してください。

```text
直近 7 日間の利用状況を見せてください
直近 30 日間に Codex と Claude で使った Token 数をそれぞれ教えてください
Quotern プロジェクトの直近 30 日間の利用状況と推定費用を集計してください
```

Skill は質問に合った照会方法を選びます。広範な利用状況レポートでは、デフォルトで総合 HTML 概要を生成し、個別の質問には簡潔に回答します。Agent は `quotern usage` で JSON を読み取ります。例：

```bash
quotern usage overview --days 7 --json --compact
quotern usage models --source codex,claude --days 30 --json --compact
```

照会ではディスクに保存済みのローカル集計だけを読み取ります。Desktop の実行中にも呼び出せるため、Web サービスを別途起動する必要はありません。Skill が暗黙のうちにサービスを起動したり、ログを同期したりすることはありません。データの新しさは直近の同期状況に左右され、費用はデータソースの報告額または料金に基づく推定です。パラメーター、データの収集範囲、費用の集計方法は[利用状況レポートと Agent による照会](./CLI.md#用量报表与-agent-查询)を参照してください。

<a id="local-data"></a>

## ローカルデータ

集計データは `~/.quotern/` に保存され、Token 数、ソース、モデル、プロジェクトへの帰属などが含まれます。パーサーは Agent のログまたはデータベースを読み取り、集計バケットを保存します。設定には、このマシンのデバイス ID などの実行情報も保存されます。

一部のソースでは、請求額やサブスクリプション枠を取得するために Agent のログイン状態を読み取る必要があります。価格カタログとデスクトップ更新でも、それぞれのサービスにアクセスします。サブスクリプションの認証情報はメインプロセスが扱い、画面には表示用スナップショットが渡されます。データの流れと各ファイルの用途は[アーキテクチャ上の注意事項](./docs/architecture-notes.md)を参照してください。

利用状況データの解析、集計、照会はローカルで行われます。デスクトップアプリと CLI パネルは同じローカル集計データを読み取ります。初回利用時に Quotern アカウントを登録する必要はありません。プロバイダーの利用枠などオンラインで取得する値は、該当サービスにアクセスできる必要があります。

## 🛠️ 開発時の注意

リポジトリの開発とテストには Node.js 22.13+ を使用します。pnpm のバージョンはルートの `package.json` に従います。リポジトリのルートで依存関係をインストールしてください。

```bash
corepack pnpm install --frozen-lockfile --prefer-offline
```

ローカル開発では `corepack pnpm dev:desktop` または `corepack pnpm dev:cli` を使用します。起動前に [worktree 開発規範](./docs/worktree-development.md)を読み、実際のパネル URL は起動時の出力で確認してください。

<details>
<summary>Electron のダウンロードが遅い場合にミラーを設定する</summary>

Electron バイナリはデフォルトで GitHub Releases からダウンロードされます。中国国内のネットワークではタイムアウトする場合があります。インストール前に、ミラー用の環境変数を設定できます。

```bash
# Git Bash / macOS / Linux
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
corepack pnpm install --frozen-lockfile --prefer-offline
```

```powershell
# PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
corepack pnpm install --frozen-lockfile --prefer-offline
```

</details>

## 🤝 貢献ガイド

ソースコードは Desktop / CLI / ブラウザパネルで協力して開発しています。ブランチの規則とローカルでの起動方法は [Contributing Guide](./CONTRIBUTING.md) を参照してください。

- [Desktop](./CONTRIBUTING.md#desktop) — Electron デスクトップアプリ
- [CLI](./CONTRIBUTING.md#cli) — コマンドラインとローカルパネル
- [Dashboard](./CONTRIBUTING.md#dashboard-开发) — CLI のブラウザパネル

メンテナンスの際は、まず次の資料を読んでください。

- [アーキテクチャ上の注意事項](./docs/architecture-notes.md)
- [データ収集と集計に関する注意事項](./docs/data-notes.md)
- [運用保守に関する注意事項](./docs/runtime-notes.md)
- [開発協業に関する注意事項](./docs/development-notes.md)

貢献者の皆さん、ありがとうございます！PR を送って掲載に参加してください。

## 📚 参考プロジェクト

- [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)：DSH に住むデスクトップペットです。100 種類以上の透過アニメーションが途切れずにつながり、DSH のセッションイベントに合わせて作業状態のアニメーションも切り替わります。
- [Token Tracker](https://github.com/xiufengsun/TokenTracker)：複数ツールの Token 利用状況を追跡する Dashboard です。この README の機能紹介とスクリーンショットの構成は、[中国語の説明](https://github.com/xiufengsun/TokenTracker/blob/main/README.zh-CN.md)を参考にしています。
- [vibe-usage](https://github.com/vibe-cafe/vibe-usage)：Token 利用状況を集計する CLI ツール
- [OpenUsage](https://github.com/robinebers/openusage)：自分のための、唯一の AI 利用状況トラッカー
- [agent-usage](https://github.com/briqt/agent-usage)：Agent のローカルセッションデータを一元収集し、Web ダッシュボードで Token 利用量、費用の推移、セッションの詳細を表示します。
- [ccusage](https://github.com/ccusage/ccusage)：Coding Agent の利用状況を分析する CLI
- [models.dev](https://models.dev)：モデル Token の料金データソース。内蔵料金表はここから差分同期されます。
