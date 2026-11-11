# Evaluation Governance P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把覆盖式跑测升级为 skill_lingshi 式不可变批次：快照、异步进度、可比性门禁与回归报告。

**Architecture:** 题库仍由 `evaluation.json` 管理；每次「运行全部/所选」创建 `EvaluationBatch` 写入 `.data/evaluation-batches.json`（或等价），固化 caseSnapshot、配置指纹与索引指纹。执行改为 queued→running→done，逐题落盘，前端轮询。比较 API 仅在指纹一致时输出变好/变差结论。当前题库上的 latest 结果可继续镜像最近一次 batch 的 case 结果，但历史以 batch 为准。

**Tech Stack:** TypeScript、Node test runner、Next.js route handlers、JSON 文件持久化（进程内锁/原子写沿用现有 persist 模式）。

## Global Constraints

- **Depends on P0：** `EvaluationRunStatus`、`auto*`/`final*`、`workflowTraceId` 已存在。
- 不引入外部队列（Redis 等）；允许进程内后台 `void executeBatch()` + 持久化进度（与 skill_lingshi 同级）。
- 可比结论必须门禁：caseSetHash、evaluatorVersion、模型/RAG 关键配置、**知识库索引指纹** 一致。
- 保留并发 3、单题失败不阻断整批。
- ERROR 不进产品通过率分母（复用 P0）。
- Follow TDD；无关日志不入库。

**Unlocks:** P2 发布门槛与概览趋势。

---

## File Structure

- `lib/types.ts`：`EvaluationBatch`、`EvaluationBatchCaseResult`、`EvaluationBatchCompareResult`、`EvaluationBatchStatus`。
- `lib/evaluation/hash.ts`：`hashCaseSet`、`evaluatorHash`、`knowledgeIndexFingerprint`。
- `lib/evaluation/batch.ts`：创建/执行/取消/列举 batch；幂等 clientRequestId。
- `lib/evaluation/batchCompare.ts`：可比性门禁 + 回归 diff。
- `lib/evaluation/batchStats.ts`：recount、productPassRate。
- `lib/db/persist.ts`：读写 `evaluation-batches.json`。
- `app/api/evaluation/batch/run/route.ts`：启动批次。
- `app/api/evaluation/batch/[id]/route.ts`：查询/取消。
- `app/api/evaluation/batch/compare/route.ts`：baseline vs candidate。
- `components/EvaluationBatchPanel.tsx`：进度、历史、对比（可嵌在 EvaluationManager）。
- `tests/evaluationBatch.test.ts`、`tests/evaluationBatchCompare.test.ts`、`tests/evaluationIndexFingerprint.test.ts`。

### Task 1: Batch + case result types

**Files:**
- Modify: `lib/types.ts`
- Create: `tests/evaluationBatchNormalize.test.ts`（若有 normalize）

**Interfaces:**
- Produces:
```ts
type EvaluationBatchStatus = "queued" | "running" | "done" | "error" | "cancelled";

interface EvaluationBatch {
  id: string;
  versionLabel: string;
  changeNote: string;
  status: EvaluationBatchStatus;
  caseIds: string[];
  caseSnapshot: EvaluationItem[]; // 输入侧快照，不含本次运行结果
  caseSetHash: string;
  evaluatorVersion: string;
  knowledgeIndexFingerprint: string;
  modelConfigSnapshot: Record<string, string | number | boolean | null>;
  ragConfigSnapshot: Record<string, string | number | boolean | null>;
  caseResults: EvaluationBatchCaseResult[];
  passed: number; failed: number; review: number; error: number;
  productPassRate: number | null;
  createdAt: string; startedAt?: string; finishedAt?: string;
  clientRequestId?: string;
}

interface EvaluationBatchCaseResult {
  caseId: string;
  status: EvaluationRunStatus;
  workflowTraceId?: string;
  systemAnswer?: string;
  autoAnswerScore?: 0 | 1 | 2;
  inTop5?: boolean;
  citationCorrect?: boolean;
  refusedCorrectly?: boolean;
  errorReason?: string;
  answerDurationMs?: number;
  tokensUsed?: number;
}
```

- [ ] **Step 1: Add types + normalize RED/GREEN if needed**
- [ ] **Step 2: Commit**

### Task 2: Fingerprints

**Files:**
- Create: `lib/evaluation/hash.ts`
- Create: `tests/evaluationIndexFingerprint.test.ts`

**Interfaces:**
- Produces: `hashCaseSet(cases): string`
- Produces: `evaluatorHash(): string`（纳入关键评分函数版本常量）
- Produces: `knowledgeIndexFingerprint(): string`  
  - 至少包含：已 indexed 且 enabled 的 documentId+updated/hash、chunk 数量或 content fingerprint 摘要、ragTables 计数  
  - 不要求把全文塞进 hash；稳定、可复现即可

- [ ] **Step 1: RED — 同输入同 hash；改文档集合则 index fingerprint 变**
- [ ] **Step 2: Implement**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 3: Persist + create batch (queued)

**Files:**
- Modify: `lib/db/persist.ts` / store
- Create: `lib/evaluation/batch.ts`（create + list + get）
- Create: `tests/evaluationBatch.test.ts`
- Create: `app/api/evaluation/batch/run/route.ts`

**Interfaces:**
- Produces: `createEvaluationBatch({ caseIds?, versionLabel, changeNote, clientRequestId?, actorUserId })`
- 15s 内相同 `clientRequestId` 返回已有 batchId（对标 skill_lingshi）
- 创建时写入 snapshot 与各类 fingerprint，status=`queued`

- [ ] **Step 1: RED — create 固化 snapshot；重复 clientRequestId 幂等**
- [ ] **Step 2: Implement persist + API**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 4: Async execute with incremental persist

**Files:**
- Modify: `lib/evaluation/batch.ts`
- Modify: `app/api/evaluation/batch/[id]/route.ts`
- Reuse: P0 `runEvaluation` 单题逻辑 → 抽 `runOneEvaluationCase(item) -> EvaluationBatchCaseResult`

**Interfaces:**
- Produces: `executeEvaluationBatch(batchId): Promise<void>`（fire-and-forget）
- 每题完成后 append `caseResults` 并 save；更新计数与 progress
- 支持 cancel 标记；`activeRuns` 防重入
- GET batch 返回 status + results + counts

- [ ] **Step 1: RED — 执行中途落盘；取消后不再追加**
- [ ] **Step 2: Implement worker + GET/cancel**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 5: Comparability gate + regression report

**Files:**
- Create: `lib/evaluation/batchCompare.ts`
- Create: `tests/evaluationBatchCompare.test.ts`
- Create: `app/api/evaluation/batch/compare/route.ts`

**Interfaces:**
- Produces: `compareEvaluationBatches(baseline, candidate): EvaluationBatchCompareResult`
- 不一致时 `comparable: false` + reasons（caseSetHash / evaluator / model / rag / knowledgeIndexFingerprint）
- 一致时输出：fixed（FAIL→PASS）、regressed（PASS→FAIL）、unchanged、metric deltas（Top5/citation/refusal/numeric if present）

- [ ] **Step 1: RED — 门禁拒绝与可比 diff**
- [ ] **Step 2: Implement + API**
- [ ] **Step 3: GREEN**
- [ ] **Step 4: Commit**

### Task 6: EvaluationBatchPanel UI

**Files:**
- Create: `components/EvaluationBatchPanel.tsx`
- Modify: `components/EvaluationManager.tsx` — 「运行」改为启动 batch + 轮询；保留题库 CRUD
- Optional: 最近 batch 结果回写题库 latest 展示字段（明确标注来源 batchId）

**Interfaces:**
- 轮询间隔 ~1.2s
- 展示进度、四分计数、productPassRate
- 选择两个 done batch 对比；不可比时只显示原因

- [ ] **Step 1: Implement panel + wire run**
- [ ] **Step 2: Manual smoke — 小批次跑通、对比门禁**
- [ ] **Step 3: Commit**

### Task 7: P1 verification gate

- [ ] **Step 1: Run batch/compare/fingerprint/P0 相关测试**
- [ ] **Step 2: Manual — 两次相同配置 batch 可比；改索引后不可比**
- [ ] **Step 3: Commit**

---

## Acceptance

- 历史 batch 不被覆盖；题库编辑不篡改旧 batch 的 caseSnapshot
- 长跑可轮询、可取消、刷新页面可恢复进度视图
- 仅指纹一致时给出“变好/变差”；知识库变更会阻断虚假趋势
- 现有领域指标仍可从 batch caseResults 聚合
