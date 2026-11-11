// 存量数据迁移：把 ragtables.json 各表行的 rowKey/aliases 与新算法对齐
// （chunks.json 已由 backfill_row_keys.mjs 重算，此处同步表格侧，保证
// 「切分查看」与表格装配看到的行主键与检索侧一致）。
//
// 用法：node --experimental-strip-types scripts/sync_ragtables_row_keys.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { buildRowKeyStats, rowKeyOfWithStats } from "../lib/rag/tableModel.ts";

const dry = process.argv.includes("--dry");
const dataPath = path.join(process.cwd(), ".data", "ragtables.json");
const backupDir = path.join(process.cwd(), ".data-backups", `ragtables-rowkey-${Date.now()}`);

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const tables = Array.isArray(raw) ? raw : raw.tables;
if (!Array.isArray(tables)) {
  console.error("无法识别 ragtables.json 结构");
  process.exit(1);
}

let changedRows = 0;
let changedTables = 0;
const samples = [];
for (const table of tables) {
  const rows = (table.rows ?? []).filter((r) => r.rowType !== "header");
  if (rows.length === 0) continue;
  // 表级值分布统计（相同行签名去重，避免展开行重复计数）。
  const seen = new Set();
  const distinctRows = [];
  for (const r of rows) {
    const cells = Object.values(r.cells ?? {});
    const sig = cells.join("\u0001");
    if (!seen.has(sig)) {
      seen.add(sig);
      distinctRows.push(cells);
    }
  }
  const stats = buildRowKeyStats(distinctRows);
  const headers = Object.keys(rows[0].cells ?? {});
  let tableChanged = false;
  for (const row of rows) {
    const cells = headers.map((h) => row.cells?.[h] ?? "");
    const { rowKey, groupKeys } = rowKeyOfWithStats(cells, headers, stats);
    if (rowKey === (row.rowKey ?? "")) continue;
    if (samples.length < 15) {
      samples.push(`  [${table.tableId.slice(0, 14)}] #${row.rowIndex} ${(row.rowKey ?? "∅").slice(0, 16)} → ${rowKey.slice(0, 24)}`);
    }
    changedRows++;
    tableChanged = true;
    if (dry) continue;
    row.rowKey = rowKey;
    const aliasSet = new Set([rowKey, ...groupKeys, ...(row.aliases ?? [])]);
    aliasSet.delete("");
    row.aliases = [...aliasSet];
  }
  if (tableChanged) changedTables++;
}

console.log(`变更 ${changedTables} 张表 / ${changedRows} 行`);
if (samples.length) console.log("样例：\n" + samples.join("\n"));

if (dry) {
  console.log("\n[dry-run] 未写盘。");
  process.exit(0);
}
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(dataPath, path.join(backupDir, "ragtables.json"));
fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2), "utf8");
console.log(`\n已备份到 ${backupDir} 并写回。重启 dev server 生效。`);
