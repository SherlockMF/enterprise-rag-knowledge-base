import type { EvaluationBatchCaseResult, EvaluationItem } from "../types.ts";

export function mirrorBatchResultsToEvaluationItems(
  items: EvaluationItem[],
  results: EvaluationBatchCaseResult[]
): EvaluationItem[] {
  const byId = new Map(results.map((result) => [result.caseId, result]));
  return items.map((item) => {
    const result = byId.get(item.id);
    if (!result) return item;
    return {
      ...item,
      systemAnswer: result.systemAnswer,
      answerScore: result.autoAnswerScore,
      autoAnswerScore: result.autoAnswerScore,
      autoStatus: result.status,
      status: result.status,
      autoJudgeUncertain: result.autoJudgeUncertain,
      inTop5: result.inTop5,
      citationCorrect: result.citationCorrect,
      refusedCorrectly: result.refusedCorrectly,
      errorReason: result.errorReason,
      answerDurationMs: result.answerDurationMs,
      tokensUsed: result.tokensUsed,
      workflowTraceId: result.workflowTraceId,
      runStartedAt: result.runStartedAt,
      runFinishedAt: result.runFinishedAt,
      runErrored: result.status === "ERROR",
    };
  });
}
