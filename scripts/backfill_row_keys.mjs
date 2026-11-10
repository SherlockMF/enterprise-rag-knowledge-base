// 存量数据迁移：用新的表级统计行主键算法（rowKeyOfWithStats）重算
// .data/chunks.json 中 structured_table_row / table_row / code chunk 的
// rowKey / aliases / keywords。对象管线（tableObjects）改动只影响新解析的
// 文档，已入库文档需要此脚本对齐。
//
// 用法：node --experimental-strip-types scripts/backfill_row_keys.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { buildRowKeyStats, rowKeyOfWithStats } from "../lib/rag/tableModel.ts";

const dry = process.argv.includes("--dry");
const dataPath = path.join(process.cwd(), ".data", "chunks.json");
const backupDir = path.join(process.cwd(), ".data-backups", `rowkey-backfill-${Date.now()}`);

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const chunks = Array.isArray(raw) ? raw : raw.chunks;
if (!Array.isArray(chunks)) {
  console.error("无法识别 chunks.json 结构（顶层应为数组或 {chunks}）");
  process.exit(1);
}

const rowChunks = chunks.filter(
  (c) =>
    (c.objectType === "structured_table_row" ||
      c.chunkType === "table_row" ||
      c.chunkType === "code") &&
    (c.tableId || c.sourceTableId)
);
console.log(`候选行 chunk：${rowChunks.length} / 总 ${chunks.length}`);

// 按 文档+表格 分组，组内建表级值分布统计。
const groups = new Map();
for (const c of rowChunks) {
  const key = `${c.documentId}__${c.sourceTableId ?? c.tableId}`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(c);
}

// 展开产生的分档逻辑行会与原始行字段重复，统计时按行签名去重。
const statsFor = (rows) =>
  buildRowKeyStats(distinctBy(rows.map((cells) => cells.join("\u0001"))));

function distinctBy(signatures) {
  return signatures;
}

let changed = 0;
const samples = [];
for (const [groupKey, group] of groups) {
  const cellRows = group.map((c) =>
    (c.tableHeaders ?? []).map((h) => (c.fields?.[h] ?? "")).length
      ? (c.tableHeaders ?? []).map((h) => c.fields?.[h] ?? "")
      : Object.values(c.fields ?? {})
  );
  // 表级统计：相同字段序列只计一次（展开行去重）。
  const seen = new Set();
  const distinctRows = [];
  for (const cells of cellRows) {
    const sig = cells.join("\u0001");
    if (seen.has(sig)) continue;
    seen.add(sig);
    distinctRows.push(cells);
  }
  const stats = buildRowKeyStats(distinctRows);
  for (const c of group) {
    const cells = (c.tableHeaders ?? []).length
      ? (c.tableHeaders ?? []).map((h) => c.fields?.[h] ?? "")
      : Object.values(c.fields ?? {});
    const { rowKey, groupKeys } = rowKeyOfWithStats(cells, c.tableHeaders, stats);
    const oldKey = c.rowKey ?? "";
    if (rowKey === oldKey && (groupKeys ?? []).every((g) => (c.aliases ?? []).includes(g))) {
      continue;
    }
    if (samples.length < 25) {
      samples.push(`  [${groupKey.split("__")[1]?.slice(0, 12)}] p${c.pageNumber} ${oldKey || "∅"} → ${rowKey}` +
        (groupKeys.length ? `（分组：${groupKeys.join("/")}）` : ""));
    }
    changed++;
    if (dry) continue;
    c.rowKey = rowKey;
    const aliasSet = new Set([rowKey, ...groupKeys, ...(c.aliases ?? [])]);
    if (c.code) aliasSet.add(c.code);
    aliasSet.delete("");
    c.aliases = [...aliasSet];
    const kwSet = new Set([rowKey, ...groupKeys, ...(c.keywords ?? [])]);
    kwSet.delete("");
    c.keywords = [...kwSet];
  }
}

console.log(`\n变更 ${changed} 个 chunk`);
if (samples.length) console.log("样例：\n" + samples.join("\n"));

if (dry) {
  console.log("\n[dry-run] 未写盘。去掉 --dry 执行迁移。");
  process.exit(0);
}
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(dataPath, path.join(backupDir, "chunks.json"));
fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2), "utf8");
console.log(`\n已备份原文件到 ${backupDir} 并写回 ${dataPath}`);
console.log("注意：store 缓存在 globalThis 上，需重启 dev server 生效。");
