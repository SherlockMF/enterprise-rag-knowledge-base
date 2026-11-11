# Evaluation Governance P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在可比批次之上形成质量运营闭环：失败聚类、发布门槛、审计坏例入题库、`/lab` 概览趋势。

**Architecture:** 只读消费 P1 的 `EvaluationBatch` 与 P0 的 `workflowTraceId`。新增纯函数聚类与 gate 评估；`/lab` 概览聚合最近可比 batch；从审计/失败结果一键生成「候选评测题」草稿（需人工补齐标准依据后启用）。不自动阻断问答服务，门禁只作用于「候选配置是否建议晋升 / 是否标红」。

**Tech Stack:** TypeScript、Node test runner、Next.js、现有 Lab UI。

## Global Constraints

- **Depends on P0 + P1** 全部验收通过。
- 不引入外部监控平台；不做跨环境集中追踪。
- 发布门槛默认只产生报告与 UI 状态，不自动改生产配置、不自动回滚模型。
- 从失败生成的 case 默认 `enabled: false`（或等价草稿），禁止未审核直接进回归集。
- Follow TDD；无关日志不入库。

---

## File Structure

- `lib/evaluation/failureClusters.ts`：按失败模式聚类。
- `lib/evaluation/releaseGate.ts`：门槛规则与评估结果。
- `lib/evaluation/caseFromFailure.ts`：从 batch result + trace 摘要生成候选题。
- `app/api/evaluation/batch/[id]/clusters/route.ts`
- `app/api/evaluation/gate/route.ts`（评估某 batch 或 baseline/candidate）
- `app/api/evaluation/cases/from-failure/route.ts`
- `app/(lab)/lab/page.tsx`：概览卡片（最近可比回归、gate 状态、Top 失败簇）
- `components/EvaluationBatchPanel.tsx` / 新 `EvaluationGatePanel.tsx` / `FailureClusterPanel.tsx`
- `tests/evaluationFailureClusters.test.ts`、`tests/evaluationReleaseGate.test.ts`、`tests/evaluationCaseFromFailure.test.ts`

### Task 1: Failure clustering

**Files:**
- Create: `lib/evaluation/failureClusters.ts`
- Create: `tests/evaluationFailureClusters.test.ts`

**Interfaces:**
- Produces: `clusterEvaluationFailures(results): FailureCluster[]`
- 建议簇 id（可扩展）：
  - `retrieval_miss`（inTop5 === false）
  - `bad_citation`
  - `acl_leak_or_permission`（权限场景 FAIL）
  - `table_numeric`
  - `false_refusal` / `missed_refusal`
  - `generation_incomplete`（有依据但低分）
  - `infra_error`（ERROR）
- 每簇：count、caseIds、代表 errorReason、可选 sample workflowTraceId

- [ ] **Step 1: RED**
- [ ] **Step 2: Implement**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 2: Release gate

**Files:**
- Create: `lib/evaluation/releaseGate.ts`
- Create: `tests/evaluationReleaseGate.test.ts`
- Create: `app/api/evaluation/gate/route.ts`

**Interfaces:**
- Produces: `evaluateReleaseGate(batch, options?): ReleaseGateResult`
- 默认规则（可配置常量，首版写死）：
  - 权限/隔离相关 FAIL === 0
  - 表格数值 FAIL === 0（若 batch 含该类题）
  - 核心法规/通用集 productPassRate ≥ 阈值（如 0.85，常量集中定义）
  - ERROR 率低于阈值（如 ≤ 5%），否则 gate = `blocked_infra`
- 结果：`passed | failed | blocked_infra` + 逐条 rule 证据
- **不**调用任何写生产配置的 API

- [ ] **Step 1: RED**
- [ ] **Step 2: Implement**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 3: Case draft from failure

**Files:**
- Create: `lib/evaluation/caseFromFailure.ts`
- Create: `tests/evaluationCaseFromFailure.test.ts`
- Create: `app/api/evaluation/cases/from-failure/route.ts`
- Modify: `components/EvaluationManager.tsx` 或 Batch/Audit UI 入口

**Interfaces:**
- Produces: 候选 `EvaluationItem` 草稿：
  - 复制 question、userId、scenario
  - `standardAnswer` / `correctFile` 等留空或从 trace 引用提示
  - 标记 `sourceBatchId` / `sourceCaseId` / `sourceTraceId`
  - 不自动 enabled 进回归（字段或约定：需人工补齐后才可入选下次 batch）
- API 写入题库但返回「待补齐」状态

- [ ] **Step 1: RED — 生成草稿不污染必填断言**
- [ ] **Step 2: Implement + UI 按钮**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 4: Lab overview trends

**Files:**
- Modify: `app/(lab)/lab/page.tsx`
- Optional: `lib/evaluation/labOverview.ts`
- Create: `tests/evaluationLabOverview.test.ts`（纯函数：选最近可比 pair、摘要）

**Interfaces:**
- 概览展示：
  - 最近一次 done batch 的 productPassRate 与 gate 灯
  - 若存在可比上一 batch：fixed / regressed 计数
  - Top 3 失败簇
  - 链到 `/lab/evaluation` 与 `/lab/audit`
- 无可比历史时明确文案「尚无可比基线」，禁止画假趋势

- [ ] **Step 1: RED for overview selector**
- [ ] **Step 2: Implement page**
- [ ] **Step 3: Manual smoke**
- [ ] **Step 4: Commit**

### Task 5: Wire clusters/gate into batch UI

**Files:**
- Modify: `components/EvaluationBatchPanel.tsx`
- Create: `components/FailureClusterPanel.tsx`（可选内联）
- Create: `components/EvaluationGatePanel.tsx`

- [ ] **Step 1: 批次详情展示簇与 gate**
- [ ] **Step 2: Smoke**
- [ ] **Step 3: Commit**

### Task 6: P2 verification gate

- [ ] **Step 1: Run P2 + 抽样 P1/P0 测试**
- [ ] **Step 2: Manual — 故意权限 FAIL 触发 gate failed；ERROR 过多触发 blocked_infra**
- [ ] **Step 3: 从失败生成草稿题，确认未自动进入强制回归集**
- [ ] **Step 4: Update roadmap 状态为 P2 完成**
- [ ] **Step 5: Commit**

---

## Acceptance

- 失败可按模式聚类并链到样本审计
- 发布门槛可对单 batch 给出可解释通过/失败，且不自动改生产
- 坏例可一键变候选题，经人工补齐后才参与正式回归
- `/lab` 概览只展示真实可比趋势，无基线时不假装变好
