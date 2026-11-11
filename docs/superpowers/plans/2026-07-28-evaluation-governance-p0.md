# Evaluation Governance P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让单次评测结果可追责：每题绑定审计 runId、区分 PASS/FAIL/REVIEW/ERROR，并把人工改分从自动分中拆开。

**Architecture:** 在现有 `EvaluationItem` 上扩展结果字段与派生状态，不引入批次实体。`runEvaluation` 每题运行时创建或关联 workflow trace，把 `workflowTraceId` 写回结果；评分函数产出 `auto*` 字段与 `status`；UI 保存人工覆写时只改 `final*` / 复核元数据。

**Tech Stack:** TypeScript、Node test runner、Next.js App Router、现有 `.data/evaluation.json` + `workflow-traces.json`。

## Global Constraints

- 不创建 EvaluationBatch；不改异步批跑模型（仍同步 HTTP `action: "run"`）。
- 不改变 `generateAnswer` 业务语义。
- 领域指标卡片继续基于现有布尔/分数字段；质量通过率分母必须排除 `ERROR`。
- Follow TDD：每个 Task 先写目标测试文件 RED，再实现 GREEN；只跑目标测试文件，整组结束后再跑相关套件。
- 保留无关未跟踪日志与 `.data-backups/`。

**Depends on:** `/lab` 产品壳已落地。  
**Unlocks:** P1 批次治理。

---

## File Structure

- `lib/types.ts`：扩展 `EvaluationItem` 结果字段与 `EvaluationRunStatus`。
- `lib/evaluation/runStatus.ts`：从自动/人工字段派生 PASS/FAIL/REVIEW/ERROR。
- `lib/evaluation/qualityMetrics.ts`：ERROR 不进质量分母；必要时展示 ERROR 计数。
- `lib/db/evaluation.ts`：跑测时写 `workflowTraceId`、`auto*`、`status`；保存时保护自动分不被覆盖丢失。
- `lib/db/workflowTraces.ts` / `lib/workflow/trace.ts`：提供可从评测侧创建查询 trace 的入口（复用现有创建逻辑）。
- `components/EvaluationManager.tsx` / `EvaluationTable.tsx`：展示状态、链接审计、人工复核表单字段。
- `app/(lab)/lab/audit/page.tsx` 或审计面板：支持 `?traceId=` 深链打开。
- `tests/evaluationRunStatus.test.ts`、`tests/evaluationQualityMetrics.test.ts`、`tests/evaluationHumanReview.test.ts`。

### Task 1: Run status model

**Files:**
- Create: `lib/evaluation/runStatus.ts`
- Modify: `lib/types.ts`
- Create: `tests/evaluationRunStatus.test.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- Produces: `type EvaluationRunStatus = "PASS" | "FAIL" | "REVIEW" | "ERROR"`
- Produces: `deriveEvaluationRunStatus(item: Pick<EvaluationItem, ...>): EvaluationRunStatus`
- Rules:
  - 系统异常 / 超时 / generateAnswer 抛错 → `ERROR`
  - `shouldRefuse` 或数值断言等硬失败且自动判定明确 → `FAIL`
  - 文件名别名命中、token 重叠边界、缺标准依据等不确定 → `REVIEW`
  - 自动质量达标且无硬失败 → `PASS`
  - 若存在人工终判，以 `finalStatus` 覆盖展示，但保留 `autoStatus`

- [ ] **Step 1: Write RED tests for deriveEvaluationRunStatus**
- [ ] **Step 2: Implement deriveEvaluationRunStatus + types**
- [ ] **Step 3: GREEN — run `tests/evaluationRunStatus.test.ts`**
- [ ] **Step 4: Commit**

### Task 2: Quality metrics exclude ERROR

**Files:**
- Modify: `lib/evaluation/qualityMetrics.ts`
- Modify: `tests/evaluationQualityMetrics.test.ts`

**Interfaces:**
- Consumes: `EvaluationItem.status` / `autoStatus`
- Produces: cards whose denominators exclude `ERROR`；summary 可含 `errorCount`

- [ ] **Step 1: Extend quality metrics tests — ERROR 不拉低通过率**
- [ ] **Step 2: Update computeQualityMetrics**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 3: Wire workflowTraceId during runEvaluation

**Files:**
- Modify: `lib/db/evaluation.ts`
- Modify: `lib/db/workflowTraces.ts`（若需导出 create-from-eval helper）
- Create: `tests/evaluationTraceLink.test.ts`（可用 stub/mock generateAnswer + trace create）

**Interfaces:**
- Produces: 每题结果含 `workflowTraceId?: string`、`runStartedAt`/`runFinishedAt`（可选）
- 跑测失败写 `status: "ERROR"`、`errorReason`，仍尽量保留已创建的 traceId
- 评测调用须带可识别 `source: "evaluation"`（若 trace 模型已有 source 字段则复用）

- [ ] **Step 1: RED — 成功跑测写入 workflowTraceId；抛错为 ERROR**
- [ ] **Step 2: Implement minimal trace link in runEvaluation**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 4: Human review fields

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/db/evaluation.ts`（`saveEvaluation` 合并逻辑）
- Create: `tests/evaluationHumanReview.test.ts`
- Modify: `components/EvaluationManager.tsx`

**Interfaces:**
- Produces on item:
  - `autoAnswerScore` / `finalAnswerScore`
  - `autoStatus` / `finalStatus?`
  - `reviewedBy?` / `reviewedAt?` / `reviewReason?`
- 保存时：若客户端只改人工字段，不得抹掉 `auto*` 与 `workflowTraceId`
- UI：改分时要求填写 `reviewReason`（可短），并带上当前 `userId`

- [ ] **Step 1: RED — save 保留 auto 分；人工覆写写入复核元数据**
- [ ] **Step 2: Implement merge + UI fields**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 5: Lab UI — status column + audit deep link

**Files:**
- Modify: `components/EvaluationTable.tsx` / `EvaluationManager.tsx`
- Modify: `components/WorkflowAuditPanel.tsx`（或 audit page）支持 `traceId` query
- Modify: `app/(lab)/lab/audit/page.tsx` 若需 server/client 读 searchParams

**Interfaces:**
- 结果表展示 `status`（优先 final，否则 auto）
- 「查看审计」→ `/lab/audit?traceId=<id>`
- 无 traceId 时按钮禁用并提示

- [ ] **Step 1: 手动/轻量测试深链能打开对应 trace（无自动化也可先写 panel 解析测试）**
- [ ] **Step 2: Implement UI**
- [ ] **Step 3: Smoke — 管理员从评测跳到审计**
- [ ] **Step 4: Commit**

### Task 6: P0 verification gate

- [ ] **Step 1: Run** `tests/evaluationRunStatus.test.ts` `tests/evaluationQualityMetrics.test.ts` `tests/evaluationHumanReview.test.ts` `tests/evaluationTraceLink.test.ts` `tests/developerTools.test.ts`
- [ ] **Step 2: Manual** — 跑 1–2 题，确认有 status、可打开审计、改分后 auto 分仍在
- [ ] **Step 3: Update roadmap status note if needed**
- [ ] **Step 4: Commit**

---

## Acceptance

- 跑测结果含 `workflowTraceId` 与 `PASS|FAIL|REVIEW|ERROR`
- 质量指标分母不含 ERROR
- 人工改分可区分自动/终判并记录复核信息
- 评测页可跳到对应工作流审计
