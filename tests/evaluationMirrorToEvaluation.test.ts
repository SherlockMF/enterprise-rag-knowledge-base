import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationBatchCaseResult, EvaluationItem } from "../lib/types.ts";
import { mirrorBatchResultsToEvaluationItems } from "../lib/evaluation/mirrorToEvaluation.ts";

function item(patch: Partial<EvaluationItem>): EvaluationItem {
  return {
    id: patch.id ?? "eval-1",
    question: patch.question ?? "q",
    standardAnswer: patch.standardAnswer ?? "a",
    correctFile: patch.correctFile ?? "f.pdf",
    correctArticle: patch.correctArticle ?? "",
    correctPage: patch.correctPage ?? "",
    shouldRefuse: patch.shouldRefuse ?? false,
    ...patch,
  };
}

function result(patch: Partial<EvaluationBatchCaseResult>): EvaluationBatchCaseResult {
  return {
    caseId: patch.caseId ?? "eval-1",
    status: patch.status ?? "PASS",
    ...patch,
  };
}

test("mirror keeps human review fields while refreshing auto run fields", () => {
  const reviewed = item({
    id: "eval-1",
    finalStatus: "FAIL",
    finalAnswerScore: 0,
    reviewedBy: "reviewer-1",
    reviewedAt: "2026-07-28T03:00:00.000Z",
    reviewReason: "人工判定应为 FAIL",
    status: "FAIL",
  });

  const merged = mirrorBatchResultsToEvaluationItems(
    [reviewed],
    [
      result({
        caseId: "eval-1",
        status: "PASS",
        autoAnswerScore: 2,
        workflowTraceId: "trace-1",
      }),
    ]
  )[0];

  assert.equal(merged.autoStatus, "PASS");
  assert.equal(merged.autoAnswerScore, 2);
  assert.equal(merged.status, "PASS");
  assert.equal(merged.workflowTraceId, "trace-1");
  assert.equal(merged.finalStatus, "FAIL");
  assert.equal(merged.finalAnswerScore, 0);
  assert.equal(merged.reviewedBy, "reviewer-1");
  assert.equal(merged.reviewReason, "人工判定应为 FAIL");
});
