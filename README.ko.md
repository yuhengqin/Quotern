<h1 align="center">Quotern</h1>

<p align="center">
  <a href="./README.en.md">English</a> · <a href="./README.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <strong>한국어</strong>
</p>

<p align="center">
  <img src="./apps/desktop/resources/icon.png" alt="Quotern 로고" width="200">
</p>

<p align="center">
  <strong>AI 사용량을 한곳에서 확인하세요.</strong><br>
  Coding Agent의 토큰, 구독 할당량, 예상 비용과 세션 기록을 한곳에서 확인하세요.
</p>

<p align="center">
  <a href="https://github.com/yuhengqin/Quotern">
    <img src="https://img.shields.io/github/stars/yuhengqin/Quotern?style=flat-square" alt="별 수">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/issues">
    <img src="https://img.shields.io/github/issues/yuhengqin/Quotern?style=flat-square" alt="이슈 수">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/releases">
    <img src="https://img.shields.io/github/downloads/yuhengqin/Quotern/total?style=flat-square" alt="다운로드 수">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/releases/latest">
    <img src="https://img.shields.io/github/v/release/yuhengqin/Quotern?include_prereleases&style=flat-square" alt="릴리스">
  </a>
  <a href="https://github.com/yuhengqin/Quotern/commits/main">
    <img src="https://img.shields.io/github/last-commit/yuhengqin/Quotern?style=flat-square" alt="마지막 커밋">
  </a>
</p>

<p align="center">
  <a href="https://github.com/yuhengqin/Quotern/releases">설치 파일 다운로드</a>
  ·
  <a href="#quick-start">빠른 시작</a>
  ·
  <a href="#feature-preview">기능 미리보기</a>
  ·
  <a href="./FAQ.md">자주 묻는 질문</a>
  ·
  <a href="#agent-integration">Agent 자동 검색 및 호출</a>
  ·
  <a href="#local-data">로컬 데이터</a>
</p>

Claude Code, Codex, Cursor, Gemini CLI 등 다양한 AI 코딩 도구의 사용량을 모아 하나의 대시보드에서 추이, 모델 및 프로젝트별 분포를 확인할 수 있습니다. macOS / Windows 데스크톱 클라이언트를 지원하며, CLI를 사용하면 macOS / Windows / Linux에서 로컬 브라우저 대시보드를 열 수 있습니다.

<p align="center">
  <img src="./assets/usage-dashboard.png" alt="Quotern 사용량 개요: 토큰, 예상 비용, 구독 할당량, 활동 히트맵" width="960">
</p>

<a id="quick-start"></a>

## ⚡ 빠른 시작

### 🖥️ 클라이언트 사용

Quotern은 macOS / Windows 데스크톱 클라이언트를 제공합니다. 설치 후 바로 사용할 수 있으며 별도 설정이 필요하지 않습니다.

#### 다운로드 및 설치

[Releases](https://github.com/yuhengqin/Quotern/releases) 페이지에서 운영체제와 아키텍처에 맞는 설치 파일을 다운로드하세요.

| 운영체제 / 칩 | 설치 파일 | 기타 다운로드 |
| --- | --- | --- |
| macOS Apple Silicon | `Quotern-<version>-mac-arm64.dmg` | 같은 이름의 `.zip` |
| macOS Intel | `Quotern-<version>-mac-x64.dmg` | 같은 이름의 `.zip` |
| Windows x64 | `Quotern-<version>-win-x64-setup.exe` | `*-win-x64-portable.exe` 포터블 버전 |
| Windows ARM64 | `Quotern-<version>-win-arm64-setup.exe` | `*-win-arm64-portable.exe` 포터블 버전 |

위 파일명 규칙은 새 릴리스 절차에 적용됩니다. 이전 버전의 첨부 파일 이름은 다를 수 있습니다. macOS는 현재 기본적으로 ad-hoc 서명을 사용하고 Apple 공증을 생략합니다. 앱 안에 다운로드 페이지로 가는 링크가 있으며, 새 버전을 직접 다운로드해 기존 앱을 교체해야 합니다. 처음 실행할 때 Gatekeeper가 차단할 수 있습니다. 프로젝트에서 제공한 파일인지 확인하고 Release의 체크섬 파일을 대조한 다음, [Apple 공식 안내](https://support.apple.com/en-us/102445)에 따라 “시스템 설정 → 개인정보 보호 및 보안”에서 “그래도 열기” 옵션을 확인할 수 있습니다. 정식 Developer ID 서명 및 공증 빌드 모드도 유지되며, 구체적인 빌드 모드는 Release 안내와 검증 보고서를 기준으로 확인하세요.

Release의 **Source code**는 해당 tag의 소스 스냅샷입니다. 컴파일 방법은 [소스 아카이브 빌드 안내](./CONTRIBUTING.md#从-source-code-归档构建)를 참조하세요.

#### 첫 실행

1. **Quotern** 앱을 엽니다.
2. 처음 실행하면 Claude / Codex Hook 등록을 시도하고 로컬 사용량을 동기화합니다.
3. 대시보드가 자동으로 열리고 사용량 추이와 모델별 분포 등의 데이터가 표시됩니다.

Claude / Codex 등의 Agent가 검색되지 않으면 해당 도구를 설치하고 한 번 이상 사용했는지 확인하세요.

사용량 데이터는 컴퓨터에 저장되며, 대시보드는 로컬 통계를 직접 읽습니다.

### ⌨️ CLI 사용

Node.js >= 20.10이 필요합니다. macOS / Windows / Linux에서는 전역 설치 없이 `npx`로 포그라운드에서 바로 실행할 수 있습니다.

```bash
npx quotern
# 대시보드: http://127.0.0.1:8252
# 중지: Ctrl+C
```

계속 사용하려면 전역 설치 후 백그라운드 서비스로 실행할 수 있습니다(시스템 시작 시 자동 실행 지원).

```bash
npm i -g quotern
quotern service start
# 대시보드: http://127.0.0.1:8252
```

중국 내 네트워크가 느리면 `npm i -g quotern --registry=https://registry.npmmirror.com/`을 사용할 수 있습니다. 전체 명령, 옵션 및 데이터 안내는 [CLI 사용 안내](./CLI.md)를 참조하세요.

자주 쓰는 명령:

```bash
quotern status           # 실행 상태 확인
quotern sync             # 로컬 사용량 수동 동기화
quotern doctor           # 환경 및 데이터 소스 점검
quotern usage --days 7   # 최근 7일 사용량 조회
```

Windows에서 처음으로 시스템 시작 시 자동 실행을 등록하려면 관리자 권한이 필요합니다. Linux 백그라운드 서비스에는 systemd 사용자 인스턴스가 필요합니다. `quotern start`로 포그라운드에서 실행할 수도 있습니다. 자세한 내용은 [CLI 빠른 시작](./CLI.md#快速开始)을 참조하세요.

## ✨ 주요 기능

- **여러 Agent의 사용량 통합**: 여러 코딩 도구의 로컬 로그와 데이터베이스를 모아 Agent, 모델 및 프로젝트별 사용량을 확인합니다.
- **사용량 추이와 활동 히트맵**: 오늘, 최근 24시간, 7 / 30 / 90일 또는 사용자 지정 기간을 선택해 입력, 출력, 캐시 및 비용 추이를 확인합니다.
- **구독 할당량 모니터링**: 연동된 채널의 잔여 할당량, 사용 기간 및 초기화 시각을 한곳에서 확인하고, 로그인 만료 등의 조회 상태도 표시합니다.
- **세션 추적**: 수집된 세션을 검색, 필터링 및 정렬하고, 펼쳐서 모델 사용량, 캐시, 비용 산정 근거 및 작업 시간을 확인합니다.
- **모델 가격 조회**: 모델 요금을 조회하고 사용 사례별로 비용을 추정해 모델을 비교합니다. 가격 카탈로그는 [models.dev](https://models.dev)에서 업데이트됩니다.
- **업적 및 공유 카드**: 활동 일수, 연속 사용 기록 및 개인 업적을 기록하고, 선택한 기간의 사용량을 다운로드하거나 복사할 수 있는 공유 카드로 만듭니다.
- **데스크톱 개요 및 펫**: 간결한 개요에서 주요 수치를 확인하고, 설정에서 데스크톱 펫을 선택하고 미리 본 뒤 크기를 조정합니다.
- **Agent에 직접 질의**: `quotern-usage` Skill로 자연어 질문을 통해 로컬 통계를 조회하며, JSON / CSV 보고서와 HTML 사용량 개요를 지원합니다.

비용은 소스가 보고한 금액, 모델 요금으로 추정한 금액, 가격을 알 수 없는 경우를 구분합니다. 표시된 비용을 실제 결제 청구액으로 간주할 수 없습니다. 세션, 메시지 및 작업 시간의 수집 범위는 데이터 소스마다 다르므로 화면의 수집 범위 안내를 확인하세요.

<a id="feature-preview"></a>

## 🖼️ 기능 미리보기

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>세션 및 사용량 추이</strong><br>
      최근 세션에서 사용 기록을 추적하고 시간별 토큰 총량과 입력, 캐시, 출력의 변화를 확인합니다.<br><br>
      <img src="./assets/sessions-and-usage-trends.png" alt="최근 세션 목록, 토큰 총량 선 그래프, 사용량 구성 막대 그래프" width="100%">
    </td>
    <td width="50%" valign="top">
      <strong>Agent, 모델 및 프로젝트별 분포</strong><br>
      사용량 순위와 분포를 살펴보고 주로 어떤 도구, 모델 및 프로젝트에서 사용량이 발생했는지 확인합니다.<br><br>
      <img src="./assets/usage-breakdown.png" alt="Agent 및 모델 사용량 순위와 프로젝트, Agent, 모델별 분포 차트" width="100%">
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <strong>세션 브라우저</strong><br>
      Agent와 프로젝트별로 필터링하고 세션을 검색하거나 정렬 방식을 바꿀 수 있습니다. 항목을 펼치면 모델, 입력 / 출력 토큰, 캐시 및 비용 상세 정보가 표시됩니다.<br><br>
      <img src="./assets/session-browser.png" alt="검색, 필터, 페이지 이동 및 상세 펼치기를 지원하는 세션 브라우저" width="100%">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>업적 전시</strong><br>
      배지, 연속 활동 기록 및 단계별로 해제되는 목표로 사용 기록을 남깁니다.<br><br>
      <img src="./assets/achievements.png" alt="업적 전시, 누적 활동 일수, 해제한 배지 및 완료가 가까운 목표" width="100%">
    </td>
    <td width="50%" valign="top">
      <strong>사용량 공유 카드</strong><br>
      기간과 Agent를 선택해 토큰, 예상 비용 및 모델 순위가 포함된 공유 카드를 생성합니다.<br><br>
      <img src="./assets/usage-share-card.png" alt="기간 필터, 모델 순위, 다운로드 및 복사 메뉴가 있는 사용량 공유 카드 미리보기" width="100%">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>간결한 사용량 개요</strong><br>
      작은 창에서 할당량, 주요 사용량 및 최근 동기화 상태를 빠르게 확인합니다.<br><br>
      <img src="./assets/compact-usage-overview.png" alt="구독 할당량, 사용량 및 동기화 상태를 보여주는 어두운 테마의 간결한 개요 창" width="300">
    </td>
    <td width="50%" valign="top">
      <strong>데스크톱 펫</strong><br>
      캐릭터를 선택하고 외형을 미리 본 뒤 크기를 조정할 수 있습니다. 선택을 적용하면 현재 펫으로 설정됩니다.<br><br>
      <img src="./assets/desktop-pet-settings.png" alt="펫 설정: 현재 펫은 Clawd이며 Da Fei Yu(大肥鱼)를 미리 보는 중입니다. 크기를 조정하거나 선택을 적용할 수 있습니다." width="100%">
    </td>
  </tr>
</table>

<details>
<summary>와이드 화면 사용량 개요 보기</summary>

![통계 카드, 구독 할당량, 연간 활동 히트맵 및 최근 세션을 포함한 와이드 화면 사용량 개요](./assets/usage-dashboard-wide.png)

</details>

## 🔌 데이터 소스와 지원 범위

| 기능 | 연동된 소스 예시 | 사용 안내 |
| --- | --- | --- |
| 토큰 및 비용 통계 | Claude Code, Codex, Cursor, Gemini CLI, OpenCode, GitHub Copilot, DeepSeek Harness, ZCode 등 | 각 도구가 제공하는 로그, 데이터베이스 또는 청구 데이터를 기반으로 합니다. 가져올 수 있는 항목과 기록 기간은 소스마다 다릅니다. |
| 구독 할당량 | Codex, Claude, Cursor, Copilot, Grok, Kimi, ZCode, Antigravity, Qoder, MiniMax, OpenCode, DeepSeek | 해당 채널에 유효한 로그인 상태나 설정이 필요합니다. 표시되는 할당량 기간은 계정 요금제에 따라 다릅니다. |
| 세션 및 작업 통계 | Claude Code, Codex, Gemini CLI, OpenCode, Copilot, pi, OMP, DeepSeek Harness, Antigravity, ZCode, Kimi | 세션과 토큰의 수집 범위는 각각 계산됩니다. 데이터가 없거나 불완전한 소스에는 수집 범위 안내가 표시됩니다. |

추가 사용량 소스로는 OpenClaw, AutoClaw, Hermes, Roo Code, Droid, Kiro, Cline, Amp, Qwen Code, CodeBuddy, WorkBuddy, Grok Build, Mimo, Every Code, Kilo CLI, Kilo Code, Goose, Zed, Warp, WPS Comate, Command Code, MiniMax Code 및 KinetAios가 있습니다. 전체 도구 목록은 [Core 데이터 소스 정의](./packages/core/src/tool-catalog.ts)를 참조하세요.

사용량 수집, 구독 할당량 및 세션 상세 정보는 각각 데이터 수집 범위가 다릅니다. 설정 및 집계 기준은 [데이터 수집 및 통계](./docs/data-notes.md), [구독 데이터 안내](./docs/subscription-plan-design.md) 및 [할당량 관리](./docs/quota-management.md)를 참조하세요.

<a id="agent-integration"></a>

## Agent 자동 검색 및 호출

Quotern은 [quotern-usage Skill](./packages/cli/skills/quotern-usage/SKILL.md)을 제공합니다. Agent Skills를 지원하는 Coding Agent는 사용량에 관한 질문을 감지해 로컬 조회 기능을 자동으로 선택하고 호출할 수 있습니다. 조회하려면 사용할 수 있는 Quotern CLI와 동기화된 로컬 데이터가 필요합니다. 데스크톱 클라이언트만 설치한 경우 CLI도 별도로 설치해야 합니다.

### 추천: npx skills로 설치

[Vercel Skills CLI](https://github.com/vercel-labs/skills)를 사용해 설치합니다. 현재 설치 프로그램은 Node.js >= 22.20을 요구하며, Quotern CLI 자체는 계속 Node.js >= 20.10을 지원합니다.

```bash
npx skills add yuhengqin/Quotern --skill quotern-usage --full-depth --global
```

안내에 따라 설치할 Agent를 선택하세요. 링크 모드를 권장합니다. Skill은 `~/.agents/skills/quotern-usage/`에 모아 저장하고, 설치 프로그램이 별도 디렉터리를 요구하는 Agent에는 링크를 만듭니다. Windows에서는 디렉터리 연결(Junction)을 사용하며, 링크를 만들 수 없으면 복사 모드를 선택할 수 있습니다. `--global`은 개인의 모든 프로젝트에서 사용할 수 있다는 뜻입니다. 현재 프로젝트에서만 사용하려면 이 옵션을 빼세요.

설치 전에 저장소에서 검색 가능한 Skill만 확인할 수도 있습니다.

```bash
npx skills add yuhengqin/Quotern --list --full-depth
```

저장소 소스에서 설치하려면 저장소 루트에서 `npx skills add ./packages/cli/skills/quotern-usage --global`을 실행합니다. 원격 저장소에 접근할 수 없으면 GitHub 저장소 접근 권한을 확인하거나 이미 체크아웃한 로컬 소스를 사용하세요.

### Agent에게 설치 요청

현재 Coding Agent에 아래 문구를 보내 [Agent 설치 안내](./README_AI.md)에 따라 설치를 완료하고 검증 결과를 보고하도록 요청하세요.

```text
https://github.com/yuhengqin/Quotern/blob/main/README_AI.md를 읽고,
현재 Agent에 quotern-usage Skill을 전역 설치하되 기존 로컬 사용자 설정은 보존해 주세요.
전체 파일, Skill 검색 경로 및 Quotern CLI를 사용할 수 있는지 검증해 주세요.
```

### 수동 복사(대안)

설치 프로그램을 사용할 수 없으면 설치된 CLI npm 패키지나 이 저장소에서 `quotern-usage` 전체 폴더를 복사하고 `references/`, `scripts/`, `assets/`를 보존하세요. 아래 예시는 현재 프로젝트의 `.agents/skills/` 디렉터리를 사용합니다. 다른 Skill 디렉터리를 사용한다면 Agent의 요구 사항에 맞게 조정하세요. CLI를 전역 설치해도 Skill이 Agent에 자동 등록되지는 않습니다.

<details>
<summary>수동 복사 명령 보기</summary>

macOS / Linux:

```bash
mkdir -p .agents/skills
cp -R "$(npm root -g)/quotern/skills/quotern-usage" .agents/skills/
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force .agents/skills | Out-Null
Copy-Item -Recurse (Join-Path (npm root -g) 'quotern/skills/quotern-usage') .agents/skills/
```

저장소의 [`packages/cli/skills/quotern-usage`](./packages/cli/skills/quotern-usage/)에서 전체 폴더를 복사할 수도 있습니다.

</details>

### Agent에서 조회하기

사용 중인 Agent의 방법에 따라 Skill을 새로고침하거나 세션을 다시 열고 `quotern-usage`가 로드됐는지 확인한 다음 질문하세요.

```text
최근 7일간 내 사용량을 확인해 줘.
최근 30일 동안 Codex와 Claude에서 각각 토큰을 얼마나 사용했어?
Quotern 프로젝트의 최근 30일 사용량과 예상 비용을 집계해 줘.
```

Skill은 질문에 맞는 조회 방식을 선택합니다. 포괄적인 사용량 보고서에는 기본적으로 종합 HTML 개요를 생성하고, 명확한 개별 질문에는 간결하게 답합니다. Agent는 `quotern usage`를 통해 JSON을 읽습니다. 예:

```bash
quotern usage overview --days 7 --json --compact
quotern usage models --source codex,claude --days 30 --json --compact
```

조회는 디스크에 저장된 로컬 통계만 읽으며 Desktop 실행 중에도 사용할 수 있습니다. 별도로 Web 서비스를 시작할 필요가 없습니다. Skill은 암묵적으로 서비스를 시작하거나 로그를 동기화하지 않습니다. 데이터의 최신성은 최근 동기화 시점에 따라 달라지며, 비용은 소스가 보고한 금액 또는 요금 기준 추정치입니다. 전체 옵션, 데이터 수집 범위 및 비용 산정 기준은 [사용량 보고서와 Agent 조회](./CLI.md#用量报表与-agent-查询)를 참조하세요.

<a id="local-data"></a>

## 로컬 데이터

통계 데이터는 `~/.quotern/`에 저장되며 토큰 수치, 소스, 모델 및 프로젝트 소속 정보 등을 포함합니다. 파서는 Agent 로그나 데이터베이스를 읽어 통계 버킷에 저장합니다. 설정에는 이 컴퓨터의 장치 식별자와 기타 실행 정보도 저장됩니다.

일부 소스는 청구 정보나 구독 할당량을 가져오기 위해 Agent 로그인 상태를 읽어야 합니다. 가격 카탈로그 및 데스크톱 업데이트도 각각의 서비스에 접속합니다. 구독 자격 증명은 메인 프로세스에서 처리하고, UI에는 표시용 스냅샷을 전달합니다. 데이터 흐름과 파일 용도는 [아키텍처 참고사항](./docs/architecture-notes.md)을 참조하세요.

사용량 데이터는 이 컴퓨터에서 파싱, 집계 및 조회되며 데스크톱 클라이언트와 CLI 대시보드는 같은 로컬 통계를 읽습니다. 처음 사용할 때 Quotern 계정을 만들 필요가 없습니다. 공급자 할당량 등의 온라인 수치를 읽으려면 해당 서비스에 접속할 수 있어야 합니다.

## 🛠️ 개발 안내

저장소 개발 및 테스트에는 Node.js 22.13 이상이 필요하며, pnpm 버전은 루트 `package.json`을 기준으로 합니다. 저장소 루트에서 의존성을 설치하세요.

```bash
corepack pnpm install --frozen-lockfile --prefer-offline
```

로컬 개발은 `corepack pnpm dev:desktop` 또는 `corepack pnpm dev:cli`로 시작합니다. 시작 전에 [worktree 개발 규칙](./docs/worktree-development.md)을 읽고, 실제 대시보드 주소는 실행 출력에서 확인하세요.

<details>
<summary>Electron 다운로드가 느릴 때 미러 설정</summary>

Electron 바이너리는 기본적으로 GitHub Releases에서 다운로드하므로 중국 내 네트워크에서는 시간 초과가 발생할 수 있습니다. 설치 전에 미러 환경 변수를 설정할 수 있습니다.

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

## 🤝 기여 안내

소스 코드는 Desktop / CLI / 브라우저 대시보드 단위로 협업합니다. 브랜치 규칙 및 로컬 실행 방법은 [Contributing Guide](./CONTRIBUTING.md)를 참조하세요.

- [Desktop](./CONTRIBUTING.md#desktop) — Electron 데스크톱 클라이언트
- [CLI](./CONTRIBUTING.md#cli) — 명령줄 및 로컬 대시보드
- [Dashboard](./CONTRIBUTING.md#dashboard-开发) — CLI 브라우저 대시보드

유지보수 전에 다음 문서를 먼저 읽어 주세요.

- [아키텍처 참고사항](./docs/architecture-notes.md)
- [데이터 수집 및 통계 참고사항](./docs/data-notes.md)
- [실행 및 유지보수 참고사항](./docs/runtime-notes.md)
- [개발 협업 참고사항](./docs/development-notes.md)

기여해 주시는 모든 분께 감사드립니다! PR을 제출하면 기여자 목록에 이름이 올라갑니다.

## 📚 참고 프로젝트

- [dsh-pet](https://github.com/PC2005-cloud/dsh-pet): DSH에 사는 데스크톱 펫입니다. 100개가 넘는 투명 애니메이션이 끊김 없이 이어지며, DSH 세션 이벤트에 따라 작업 상태 애니메이션도 바꿀 수 있습니다.
- [Token Tracker](https://github.com/xiufengsun/TokenTracker): 여러 도구의 토큰 사용량을 추적하는 대시보드입니다. 이 README의 기능 소개와 스크린샷 배치는 해당 프로젝트의 [중국어 안내](https://github.com/xiufengsun/TokenTracker/blob/main/README.zh-CN.md)를 참고했습니다.
- [vibe-usage](https://github.com/vibe-cafe/vibe-usage): 토큰 사용량 통계 도구(CLI)
- [OpenUsage](https://github.com/robinebers/openusage): 오직 당신을 위한 AI 사용량 추적기
- [agent-usage](https://github.com/briqt/agent-usage): Agent의 로컬 세션 데이터를 모아 웹 대시보드에서 토큰 사용량, 비용 추이 및 세션 상세 정보를 보여줍니다.
- [ccusage](https://github.com/ccusage/ccusage): Coding Agent 사용량 분석 CLI
- [models.dev](https://models.dev): 모델 토큰 요금 데이터 소스입니다. 내장 요금표는 이곳에서 증분 동기화됩니다.
