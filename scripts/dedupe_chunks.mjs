// 存量数据迁移：对 .data/chunks.json 做入库级近重复去重（与 chunk.ts 的
// dedupeChunkDrafts 同规则），删除同一事实被多个抽取器重复生成的孪生块。
// 只在**同一文档内**去重：跨文档的相同条文是交叉印证信号，不可删。
//
// 用法：node --experimental-strip-types scripts/dedupe_chunks.mjs [--dry]
import fs from "node:fs";
import path from "node:path";

const dry = process.argv.includes("--dry");
const dataPath = path.join(process.cwd(), ".data", "chunks.json");
const backupDir = path.join(process.cwd(), ".data-backups", `dedupe-chunks-${Date.now()}`);

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const chunks = Array.isArray(raw) ? raw : raw.chunks;
if (!Array.isArray(chunks)) {
  console.error("无法识别 chunks.json 结构");
  process.exit(1);
}
console.log(`去重前: ${chunks.length}`);

const PRIORITY = ["code", "table_row", "indicator", "definition", "clause", "requirement", "list_item", "deliverable", "procedure", "note"];
const SKIP = new Set(["table_full"]);
const norm = (t) => (t || "").replace(/[，。、；：,.:;|【】()[\]（）\s]/g, "");
const priority = (t) => {
  const i = PRIORITY.indexOf(t);
  return i === -1 ? PRIORITY.length : i;
};

const kept = [];
const dropped = [];
// 按文档分组去重，保持组内原顺序（组间结果按原顺序合并）。
const byDoc = new Map();
for (const [index, chunk] of chunks.entries()) {
  (byDoc.get(chunk.documentId) ?? byDoc.set(chunk.documentId, []).get(chunk.documentId)).push({ chunk, index });
}
for (const docs of byDoc.values()) {
  const order = docs.sort(
    (a, b) =>
      priority(a.chunk.chunkType) - priority(b.chunk.chunkType) || a.index - b.index
  );
  const docKept = [];
  for (const { chunk, index } of order) {
    const key = norm(chunk.content);
    const entry = { chunk, key, index };
    if (SKIP.has(chunk.chunkType) || !key) {
      docKept.push(entry);
      continue;
    }
    const isDup = docKept.some(({ chunk: prevChunk, key: prev }) => {
      if (SKIP.has(prevChunk.chunkType)) return false;
      if (prev.length < 12 && key.length < 12) return prev === key;
      return prev.includes(key) || key.includes(prev);
    });
    if (isDup) dropped.push(chunk);
    else docKept.push(entry);
  }
  kept.push(...docKept);
}

const result = kept.sort((a, b) => a.index - b.index).map((k) => k.chunk);
const dropTypes = {};
for (const c of dropped) {
  const k = c.chunkType + "/" + (c.objectType || "");
  dropTypes[k] = (dropTypes[k] || 0) + 1;
}
console.log(`去重后: ${result.length}（删除 ${dropped.length}）`);
console.log("删除分布:", Object.entries(dropTypes).sort((a, b) => b[1] - a[1]).slice(0, 8));

if (dry) {
  console.log("\n[dry-run] 未写盘。去掉 --dry 执行。");
  process.exit(0);
}
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(dataPath, path.join(backupDir, "chunks.json"));
fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2), "utf8");
console.log(`\n已备份到 ${backupDir} 并写回。重启 dev server 生效。`);
