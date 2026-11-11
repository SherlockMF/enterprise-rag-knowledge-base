import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowKeyStats,
  rowKeyOf,
  rowKeyOfWithStats,
} from "../lib/rag/tableModel.ts";
import type { Chunk, RetrievedChunk } from "../lib/types.ts";
import { rerank } from "../lib/rag/rerank.ts";

// ============================================================================
// 行主键三判据（2026-11 产业用地案例的回归防线）：
//   ① 跨行重复的名称值 = 分组（合并单元格外层类别）→ 降级为 groupKey 别名；
//   ② 重复主体（其余列只有档位值时）保持为键；
//   ③ 档位值（汉字+数字混合 / 字母档位）不当键，字母编码（A1/F81）是身份。
// ============================================================================

test("合并单元格对应表：外层分类降级为分组，子行身份成为主键", () => {
  const headers = ["用地分类", "列2", "列3", "原控规标准对应关系", "本控规标准对应关系"];
  const rows = [
    ["城乡建设用地", "住宅用地", "住宅用地", "R1一类居住用地、R2二类居住用地", "0701城镇住宅用地"],
    [
      "城乡建设用地",
      "产业用地",
      "产业用地",
      "M1一类工业用地、M2二类工业用地、W1物流用地、W2普通仓储用地、B1商业用地、B2商务用地",
      "1001工业用地、11仓储用地",
    ],
    ["城乡建设用地", "其中", "商业商务用地", "B1商业用地、B2商务用地、B3娱乐康体用地", "09商业服务业用地"],
    ["城乡建设用地", "其中", "生产研发用地", "M1一类工业用地、M4工业研发用地", "090203办公研发用地"],
  ];
  const stats = buildRowKeyStats(rows);
  const keys = rows.map((r) => rowKeyOfWithStats(r, headers, stats));

  assert.deepEqual(
    keys.map((k) => k.rowKey),
    ["住宅用地", "产业用地", "商业商务用地", "生产研发用地"]
  );
  for (const k of keys) {
    assert.ok(
      k.groupKeys.includes("城乡建设用地"),
      `外层分类应降级为分组别名，实际 groupKeys=${JSON.stringify(k.groupKeys)}`
    );
  }
});

test("代码表：字母开头的用地代码是行身份，不是档位", () => {
  const headers = ["代码", "名称", "内容"];
  const rows = [
    ["A1", "公共管理", "行政办公等设施"],
    ["A11", "行政办公", "党政机关办公设施"],
    ["F81", "绿隔产业用地", "根据绿化隔离地区有关政策安排的产业用地"],
  ];
  const stats = buildRowKeyStats(rows);
  assert.deepEqual(
    rows.map((r) => rowKeyOfWithStats(r, headers, stats).rowKey),
    ["A1", "A11", "F81"]
  );
});

test("重复主体：按办学规模拆行的设施名保持为主键", () => {
  const headers = ["层级", "设施名称", "服务范围", "办学规模", "地上建筑面积(平方米/处)"];
  const rows = [
    ["社区级", "托幼", "3周岁以下", "8班", "3100"],
    ["社区级", "托幼", "3-6岁", "12班", "4500"],
    ["社区级", "小学", "6-12岁", "20班", "6100"],
  ];
  const stats = buildRowKeyStats(rows);
  const keys = rows.map((r) => rowKeyOfWithStats(r, headers, stats));
  assert.deepEqual(
    keys.map((k) => k.rowKey),
    ["托幼", "托幼", "小学"]
  );
});

test("分档表：A类/B类档位不当键，设施名经由兜底保持为主键", () => {
  const headers = ["设施名称", "分档", "一般规模(平方米)"];
  const rows = [
    ["社区卫生服务中心", "A类", "3000-4000"],
    ["社区卫生服务中心", "B类", "2000-3000"],
    ["社区卫生服务中心", "C类", "1000-2000"],
  ];
  const stats = buildRowKeyStats(rows);
  const keys = rows.map((r) => rowKeyOfWithStats(r, headers, stats));
  assert.deepEqual(
    keys.map((k) => k.rowKey),
    ["社区卫生服务中心", "社区卫生服务中心", "社区卫生服务中心"]
  );
});

test("结构词与散文不当主键", () => {
  const headers = ["层级", "设施名称", "配置要求"];
  const rows = [
    ["社区级", "电动自行车停车处", "按每户0.5辆配建，宜结合出入口广场设置充电设施。"],
    ["社区级", "合计", "共300处"],
  ];
  const stats = buildRowKeyStats(rows);
  const keys = rows.map((r) => rowKeyOfWithStats(r, headers, stats));
  assert.equal(keys[0].rowKey, "电动自行车停车处");
  // "合计"是结构词：兜底也不应选中它（选中了首个非纯数字 cell 前的名称列）
  assert.notEqual(keys[1].rowKey, "合计");
});

test("枚举长串与句读散文不参与主键竞争", () => {
  const headers = ["用地分类", "对应关系"];
  const rows = [
    [
      "产业用地",
      "M1一类工业用地、M2二类工业用地、M3三类工业用地、W1物流用地、W2普通仓储用地、W3特殊仓储用地",
    ],
  ];
  const stats = buildRowKeyStats(rows);
  assert.equal(rowKeyOfWithStats(rows[0], headers, stats).rowKey, "产业用地");
});

test("缺省 stats 时退化为旧的表头优先规则（与 rowKeyOf 一致）", () => {
  const rows = [
    ["A1", "公共管理", "行政办公等设施"],
    ["社区级", "社区服务站", "每个社区1处"],
    ["居住用地", "R1一类居住用地", "低层为主"],
  ];
  for (const row of rows) {
    assert.equal(rowKeyOfWithStats(row, undefined).rowKey, rowKeyOf(row));
  }
});

// ============================================================================
// 组成类问题的检索排序回归：复现"产业用地包含什么用地"的失败形态——
// 同文档短定义块（关键词密集）vs 异文档枚举表格行（向量最高），rerank
// 后正确行必须排第一。
// ============================================================================

function makeRetrieved(
  chunk: Partial<Chunk> & Pick<Chunk, "id" | "documentId" | "content">,
  scores: { keywordScore: number; vectorScore: number }
): RetrievedChunk {
  return {
    chunk: {
      chunkType: "table_row",
      objectType: "structured_table_row",
      fileName: "测试文档.pdf",
      pageNumber: 1,
      chunkRole: "atomic",
      ...chunk,
    } as Chunk,
    keywordScore: scores.keywordScore,
    vectorScore: scores.vectorScore,
    rerankScore: 0,
    source: "hybrid",
    matchedKeywords: [],
  };
}

test("组成类问题：枚举表格行在 rerank 后超过短定义块排到第一", () => {
  const question = "产业用地包含什么用地？";
  const candidates: RetrievedChunk[] = [
    // 正确答案：控规文档的产业用地行（向量最高，关键词密度低）
    makeRetrieved(
      {
        id: "row-chanyeyongdi",
        documentId: "doc-kongui",
        fileName: "北京市控制性详细规划编制技术标准与成果规范-2022年9月版.pdf",
        chunkType: "table_row",
        objectType: "structured_table_row",
        rowKey: "产业用地",
        aliases: ["产业用地", "城乡建设用地"],
        tableTitle: "2、规划用地功能分类结构表统计核算说明",
        fields: { 列2: "产业用地" },
        versionInfo: { status: "internal" } as Chunk["versionInfo"],
        content:
          "用地分类：城乡建设用地。列2：产业用地。列3：产业用地。原控规标准延续分区规划与新京标对应关系：M1一类工业用地、M2二类工业用地、M3三类工业用地、M4工业研发用地、W1物流用地、W2普通仓储用地、W3特殊仓储用地、B1商业用地、B2商务用地、B3娱乐康体用地、B4综合性商业金融服务业用地、B9其他服务设施用地、F2公建混合住宅用地、F3其他类多功能用地、F81绿隔产业用地（产业部分）、F82绿色产业用地、C3村庄产业用地。",
      },
      { keywordScore: 0.52, vectorScore: 0.59 }
    ),
    // 干扰项：同词短定义块（关键词密度高，历史版本曾霸榜第一）
    makeRetrieved(
      {
        id: "def-lvge",
        documentId: "doc-fenlei",
        fileName: "北京市城乡规划用地分类标准.pdf",
        chunkType: "indicator",
        objectType: "indicator_item",
        rowKey: "绿隔产业用地",
        aliases: ["绿隔产业用地"],
        tableTitle: "城乡规划用地分类和代码",
        versionInfo: { status: "current" } as Chunk["versionInfo"],
        content:
          "小类：F81。类别名称：绿隔产业用地。内容：根据绿化隔离地区有关政策，为保障绿地实施及集体经济发展安排的产业用地",
      },
      { keywordScore: 0.8, vectorScore: 0.54 }
    ),
    makeRetrieved(
      {
        id: "def-lüse",
        documentId: "doc-fenlei",
        fileName: "北京市城乡规划用地分类标准.pdf",
        chunkType: "indicator",
        objectType: "indicator_item",
        rowKey: "绿色产业用地",
        aliases: ["绿色产业用地"],
        tableTitle: "城乡规划用地分类和代码",
        versionInfo: { status: "current" } as Chunk["versionInfo"],
        content:
          "小类：F82。类别名称：绿色产业用地。内容：根据绿化隔离地区有关政策，为绿地的管理养护提供资金保障集中安排的服务设施用地",
      },
      { keywordScore: 0.78, vectorScore: 0.52 }
    ),
  ];

  const ranked = rerank(candidates, { question });
  assert.equal(ranked[0].chunk.id, "row-chanyeyongdi");
});
