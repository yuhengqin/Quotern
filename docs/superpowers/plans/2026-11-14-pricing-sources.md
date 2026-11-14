# Pricing Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成用户确认的多源补缺、同步质量检查、特殊费率转换和持续过期刷新。

**Architecture:** Core 的共享纯转换模块供底表脚本和 runtime 使用；现有分层计价与请求事实保持。单一刷新句柄管理定时、resume、取消与缓存发布；共享价格页从 HTTP/IPC 表中读取安全元数据。

**Tech Stack:** Node 22.13+、TypeScript/ESM、corepack pnpm 11.1.2、Node test、React/HeroUI、Electron。

**Spec:** `docs/superpowers/specs/2026-11-14-pricing-sources-design.md`

## Global Constraints

- main 干净且无明确其他可写任务，按项目规则直接 main；不停止现有不属本会话的 CLI/Vite。
- 用户单价、来源报告金额、明确零价、订阅目录、已有人工条目和规则必须保留。
- 公共源只使用同厂商直连模型，不引入 OpenRouter 转售价；特殊价缺失不猜测。
- 网络总超时 30 秒、启动等待 3 秒、默认过期 24h、失败重试至少 1h。
- 每个刷新句柄一个在途请求；停止/替换后不应用旧代；变价才触发历史重算。
- Dashboard/Desktop 共用价格 UI，保持现有格式化及四语言。

## Review Focus

- models.dev 有价格而 LiteLLM 是其他渠道或不同基础价时，不覆盖、不拼接缓存价/档位。
- 主源暂时失败不等于模型被删除；仅成功读取的源能更新 last-seen/carried 状态。
- 1h 缓存字段不误当 token 阈值，缺失 tier/context 组合不乘出猜测价格。
- metadata-only 重验证不使费用缓存失效；用户单价仍接受自动规则关系，明确手工规则不变。
- stop/restart 与异步落盘、timer/resume、历史重算重叠时，旧结果不覆盖新状态。

### Task 1: Shared source conversion and synchronization checks

**Files:** Create `packages/core/src/pricing/litellm.mjs`, `pricing-sources.mjs`; modify `models-dev.mjs`, `matcher.ts`, `packages/core/scripts/sync-pricing.mjs`; add `packages/core/scripts/pricing-sources.test.mjs`; adjust existing sync fixtures.

**Interfaces:** `mergePricingSources(current, sources, checkedAt)` returns PricingData with `price_metadata` and bounded `_meta.sync_report`; `loadPricingSources(current, fetchImpl, signal)` fetches the two fixed public URLs and applies the same conversion.

- [x] Write failing fixture tests for source identity, main-source priority, compatible missing fields, failure/deletion distinctions, zero/invalid values and bounded diff reports.
- [x] Run `node --test packages/core/scripts/pricing-sources.test.mjs` and confirm behavioral failures.
- [x] Implement conservative adapter, metadata/quality checks and shared fetch entry; update script and proxy fixtures.
- [x] Run all `packages/core/scripts/*.test.mjs`.

### Task 2: Automatic request rules and stable computation fingerprints

**Files:** Modify `litellm.mjs`, `request-pricing.ts`, `pricing/index.ts`; add `packages/core/test/litellm-request-pricing.test.ts`; extend fingerprint regression tests.

**Interfaces:** generated RequestPricingRule carries explicit `origin` and per-field `multipliers`; original `rates` and HTTPS `reference` remain. `getPricingFingerprint()` excludes display/freshness metadata while including matching/rates/rules/manual/algorithm revision.

- [x] Write failing tests for 272000/272001, independently published fast/flex/context combinations, 5m/1h, manual base overrides and preserved curated rules.
- [x] Compile Core tests and run the new test plus request-pricing/pricing tests to confirm failures.
- [x] Implement conversion/validation/application and stable computational versioning.
- [x] Run affected Core tests and source adapter tests.

### Task 3: Scheduled revalidation and responsive lifecycle

**Files:** Modify Core pricing refresh/config/defaults; CLI index; Desktop local-runtime/main lifecycle; aggregate-cache and targeted tests.

**Interfaces:** PricingRefreshHandle adds `refreshIfStale(): Promise<boolean>`; callback adds compatible `ratesChanged` evidence; default ttl is 86400000, retry floor 3600000; source fetch is shared with Task 1.

- [x] Write failing controlled-time tests for expiration, single-flight timer/resume, retry, cancellation, late writes and metadata-only behavior; add representative history correctness/response test.
- [x] Run targeted tests and verify expected failures.
- [x] Implement lifecycle, proxy/cancellation-safe publication, default migration, cross-platform resume and guarded change callbacks; reduce historical repeated scans.
- [x] Run Core/CLI/Desktop tests and typechecks.

### Task 4: Provenance UI, integrated verification and closeout

**Files:** Modify shared pricing-data/PricingDetails/PricingPage and four-language pricing messages; metadata API tests; add bounded price-refresh UI/Electron smoke fixture; update AGENTS/data/runtime/UI docs.

**Interfaces:** catalog rows carry safe price provenance; summary carries checked time and bounded sync counts. UI uses existing channel details/data help and existing formatters; Desktop reuses shared implementation.

- [x] Add catalog projection/translation/fixture assertions and confirm absent metadata fails.
- [x] Implement source/last verified/carried details and nonintrusive sync summary, preserving old runtime compatibility.
- [x] Run both renderer builds, actual HTTP/IPC interactions, Electron changed-price/history responsiveness, and full `corepack pnpm test`.
- [x] Request one fresh read-only whole-change review, fix concrete findings with regression tests, and rerun applicable checks.
- [x] Update docs and commit only this task's files after successful verification; report commit and material unverified environments.
