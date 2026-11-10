// ============================================================================
// 表格模型（需求 3、4）
// ----------------------------------------------------------------------------
// 输入：一组 \t 分隔的表格行（已去 [[T]] 标记）。
// 输出：TableModel（headers/rows/markdown）+ 行展开为带字段名的自然语言。
// 关键能力：
//  - 多行表头合并（如 "一般规模" + "建筑面积" → "一般规模-建筑面积"）；
//  - 跨页续表继承前表表头（inheritHeaders）；
//  - 行 → 自然语言："表名。设施名称：物业服务用房。一般规模-建筑面积：150。"
// ============================================================================

import type { TableModel } from "@/lib/types";

/** 单元格是否为"数值/取值"型（用于区分表头行与数据行）。 */
function isValueCell(cell: string): boolean {
  const c = cell.trim();
  if (!c) return false;
  if (/^[-—–~～/]+$/.test(c)) return true; // 纯连字符/区间符
  // 含数字，且不是以中文长词为主（避免把"每个项目1处"早判为表头分界）
  if (/\d/.test(c) && c.replace(/[^一-龥]/g, "").length <= 2) return true;
  return false;
}

/** 长 prose 单元格阈值：表头列名通常很短，>20 字几乎一定是正文数据。 */
const LONG_CELL = 20;
function isLongTextCell(cell: string): boolean {
  return cell.trim().length > LONG_CELL;
}

/**
 * 一行是否为"数据行"：
 *  - 首列之后出现取值型单元格（数值/区间/连字符）；或
 *  - 任意单元格是长 prose（说明/要求类表的数据格是整段文字，无数字，
 *    早期版本据此把数据行误判为表头并吞掉整表，此处修正）。
 */
function isDataRow(row: string[]): boolean {
  for (let i = 0; i < row.length; i++) {
    if (i >= 1 && isValueCell(row[i])) return true;
    if (isLongTextCell(row[i])) return true;
  }
  if (row.length === 1) return isValueCell(row[0]) || isLongTextCell(row[0]);
  return false;
}

/** 判定前导表头行数（1..3）：从第一行起，直到遇到数据行。 */
function detectHeaderRowCount(rows: string[][]): number {
  let count = 0;
  for (let i = 0; i < rows.length && i < 3; i++) {
    if (isDataRow(rows[i])) break;
    count++;
  }
  return Math.max(1, count);
}

function hasLowerHeaderText(
  headerRows: Array<Array<string | null>>,
  rowIndex: number,
  colIndex: number
): boolean {
  for (let r = rowIndex + 1; r < headerRows.length; r++) {
    if ((headerRows[r][colIndex] ?? "").trim()) return true;
  }
  return false;
}

function propagateColspanParents(
  headerRows: Array<Array<string | null>>
): string[][] {
  return headerRows.map((row, rowIndex) => {
    let parent = "";
    return row.map((cell, colIndex) => {
      const value = (cell ?? "").trim();
      if (value) {
        parent = value;
        return value;
      }
      if (parent && hasLowerHeaderText(headerRows, rowIndex, colIndex)) {
        return parent;
      }
      return "";
    });
  });
}

/** 合并多行表头：先传播 colspan 父表头，再逐列收集非空片段，用 "-" 连接。 */
function mergeHeaderRows(headerRows: string[][], cols: number): string[] {
  return buildHeaderPaths(headerRows, cols).map(displayHeaderFromPath);
}

function buildHeaderPaths(headerRows: string[][], cols: number): string[][] {
  const propagated = propagateColspanParents(headerRows);
  const paths: string[][] = [];
  for (let c = 0; c < cols; c++) {
    const parts: string[] = [];
    for (const r of propagated) {
      const cell = (r[c] ?? "").trim();
      if (cell && !parts.includes(cell)) parts.push(cell);
    }
    paths.push(parts);
  }
  return paths;
}

const STANDALONE_LEAF_HEADER = /^(服务规模)$/;

function displayHeaderFromPath(path: string[]): string {
  if (path.length > 1 && STANDALONE_LEAF_HEADER.test(path[path.length - 1])) {
    return path[path.length - 1];
  }
  return path.join("-");
}

function padHeaders(headers: string[], cols: number): string[] {
  const out = headers.slice(0, cols);
  while (out.length < cols) out.push(`列${out.length + 1}`);
  return out;
}

/** 生成 GFM markdown 表格。 */
export function toMarkdown(headers: string[], rows: string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").trim() || " ";
  const head = `| ${headers.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${headers.map((_, i) => esc(r[i] ?? "")).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

export interface BuildTableOptions {
  tableId: string;
  title?: string;
  /** 续表继承的表头 */
  inheritHeaders?: string[];
}

/** 从 \t 分隔行构建 TableModel。 */
export function buildTableModel(
  lines: string[],
  opts: BuildTableOptions
): TableModel {
  const rawRows = lines
    .map((l) => l.split("\t").map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));

  const maxCols = Math.max(1, ...rawRows.map((r) => r.length));
  const rows = rawRows.map((r) => {
    const copy = r.slice();
    while (copy.length < maxCols) copy.push("");
    return copy;
  });

  let headers: string[];
  let headerPaths: string[][] | undefined;
  let dataRows: string[][];

  if (opts.inheritHeaders && opts.inheritHeaders.length) {
    headers = padHeaders(opts.inheritHeaders, maxCols);
    headerPaths = headers.map((header) =>
      header.split("-").map((part) => part.trim()).filter(Boolean)
    );
    dataRows = rows;
  } else if (rows.length === 0) {
    headers = [];
    headerPaths = [];
    dataRows = [];
  } else {
    const hrCount = detectHeaderRowCount(rows);
    headers = mergeHeaderRows(rows.slice(0, hrCount), maxCols);
    headerPaths = buildHeaderPaths(rows.slice(0, hrCount), maxCols);
    dataRows = rows.slice(hrCount);
  }

  dataRows = dataRows.filter((r) => r.some((c) => c !== ""));

  return {
    tableId: opts.tableId,
    title: opts.title,
    headers,
    headerPaths,
    rows: dataRows,
    markdown: toMarkdown(headers, dataRows),
  };
}

/** 归一化单元格：null→""；保留格内视觉换行，只压缩同行空白。 */
function normCell(c: string | null | undefined): string {
  if (c == null) return "";
  return c
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
    .trim();
}

/**
 * 从单元格矩阵构建 TableModel（pdfplumber sidecar 路径）。
 *  - 合并单元格在矩阵中为 null：数据行按列「前向填充」承接上一行的值
 *    （如「层级=项目级」纵向合并跨多行，下方行 null → 填回「项目级」）；
 *  - 表头行（前导非数据行）用 mergeHeaderRows 合并为单层列名；
 *  - 续表通过 inheritHeaders 继承前表表头。
 */
export function buildTableModelFromMatrix(
  matrix: (string | null)[][],
  opts: BuildTableOptions
): TableModel {
  const maxCols = Math.max(1, ...matrix.map((r) => r.length));
  const rows = matrix.map((r) => {
    const c = r.slice();
    while (c.length < maxCols) c.push(null);
    return c;
  });

  let headers: string[];
  let headerPaths: string[][] | undefined;
  let dataStart: number;
  if (opts.inheritHeaders && opts.inheritHeaders.length) {
    headers = padHeaders(opts.inheritHeaders, maxCols);
    headerPaths = headers.map((header) =>
      header.split("-").map((part) => part.trim()).filter(Boolean)
    );
    dataStart = 0;
  } else if (rows.length === 0) {
    return { tableId: opts.tableId, title: opts.title, headers: [], rows: [], markdown: "" };
  } else {
    const norm = rows.map((r) => r.map(normCell));
    const hrCount = detectHeaderRowCount(norm);
    headers = mergeHeaderRows(norm.slice(0, hrCount), maxCols);
    headerPaths = buildHeaderPaths(norm.slice(0, hrCount), maxCols);
    dataStart = hrCount;
  }

  // 数据行：仅对 null（合并单元格）前向填充，"" 与 "-" 视为真实值保留
  const filled: string[][] = [];
  const last = new Array<string>(maxCols).fill("");
  for (const r of rows.slice(dataStart)) {
    const fr: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const raw = r[c];
      if (raw == null) {
        fr.push(last[c]);
      } else {
        const v = normCell(raw);
        fr.push(v);
        if (v) last[c] = v;
      }
    }
    filled.push(fr);
  }
  const dataRows = filled.filter((r) => r.some((c) => c !== ""));

  return {
    tableId: opts.tableId,
    title: opts.title,
    headers,
    headerPaths,
    rows: dataRows,
    markdown: toMarkdown(headers, dataRows),
  };
}

/** 名称型表头（强：直接是对象名；弱：指标/类别，作次选）。 */
const STRONG_NAME_HEADER = /(名称|设施|术语|代码|对象|项目)/;
const WEAK_NAME_HEADER = /(指标|类别|用地|分类|管控)/;
const NUMERIC_ONLY = /^[\d\s\-—–./%()（）]+$/;

/** 行主键：优先取「名称型列」的值（设施名称/指标名称/类别/代码…），
 *  否则取首个非纯数字单元格，再否则取首个非空单元格。 */
export function rowKeyOf(row: string[], headers?: string[]): string {
  if (headers && headers.length) {
    for (const re of [STRONG_NAME_HEADER, WEAK_NAME_HEADER]) {
      for (let i = 0; i < headers.length; i++) {
        const v = (row[i] ?? "").trim();
        if (re.test(headers[i]) && v && !NUMERIC_ONLY.test(v)) return v;
      }
    }
  }
  for (const c of row) {
    const t = (c ?? "").trim();
    if (t && !NUMERIC_ONLY.test(t)) return t;
  }
  for (const c of row) {
    const t = (c ?? "").trim();
    if (t) return t;
  }
  return "";
}

// ============================================================================
// 行主键（第一性原理）：主键 = 在兄弟行中区分度最高的名义值。
// ----------------------------------------------------------------------------
// 单看一行无法区分「这一行的身份」和「它所属的分组」——合并单元格的外层
// 类别（如"城乡建设用地"）在行内看起来和行键一模一样。判据必须来自表级：
// 同一值跨多行重复 ⇒ 它是分组/分类，不是其中某一行的身份。因此行主键的
// 计算需要整张表的值分布统计，而不是逐行独立决策。
// ============================================================================

/** 表级值分布统计：每列 → 单元格值 → 该值出现的原始行数。 */
export interface RowKeyStats {
  rowCount: number;
  valueRowCount: Array<Map<string, number>>;
}

export function buildRowKeyStats(rows: string[][]): RowKeyStats {
  const valueRowCount: Array<Map<string, number>> = [];
  for (const row of rows) {
    (row ?? []).forEach((cell, i) => {
      const v = (cell ?? "").trim();
      if (!v) return;
      (valueRowCount[i] ??= new Map()).set(v, (valueRowCount[i].get(v) ?? 0) + 1);
    });
  }
  return { rowCount: rows.length, valueRowCount };
}

/** 名义值：短、非纯数字、非枚举散文——枚举长串是内容列，不是身份。 */
function isNominalCell(v: string): boolean {
  if (!v || NUMERIC_ONLY.test(v)) return false;
  if (v.length > 30) return false;
  if (/[。；;]/.test(v)) return false; // 句读 = 说明散文
  if ((v.match(/、/g) ?? []).length >= 2) return false;
  return true;
}

export interface RowKeyResult {
  rowKey: string;
  /** 被降级的分组值（合并单元格的外层类别）；仍作为别名保留检索入口。 */
  groupKeys: string[];
}

/** 表格结构词：任何情况下都不该是某一行的身份。 */
const STRUCTURAL_LABEL =
  /^(其中|合计|小计|总计|共计|序号|备注|其他|其它|指标|说明|内容|名称|代码)$/;

/** 档位型值：汉字+数字混合的规格区间（"岁6以下""1200-1500平方米""18班"）或
 *  字母档位（"A类""B级"）。行间差异的档位，不是实体名，只在兜底作主键。
 *  注意：字母开头的编码（A1/F81/B23）是用地代码=行身份，不算档位；
 *  纯数字/区间（1200-1500）由 NUMERIC_ONLY 排除，两字中文词（托幼）是主体。 */
const isTierLike = (v: string): boolean =>
  (/\d/.test(v) && /[一-龥]/.test(v)) || /^[A-Za-z][类级档次]{1,2}$/.test(v);

/**
 * 带表级统计的行主键。与 rowKeyOf 的区别：
 *  - 跨多行重复的名称值（覆盖率 ≥ 1/3）判定为分组值，不作为该行主键，
 *    而是降级进 groupKeys（别名），让"外层分类"和"行身份"都可被检索；
 *  - 降级的前提是存在「非档位型」的唯一身份值（无数字、非结构词的名词值）。
 *    没有时（如"托幼"按办学规模拆多行），重复名称就是行主体，保持为键——
 *    分组值和重复主体的判据来自"其余列有没有像身份的值"，而非重复本身；
 *  - stats 缺省时所有值视为唯一，退化为 rowKeyOf 的表头优先规则。
 */
export function rowKeyOfWithStats(
  row: string[],
  headers: string[] | undefined,
  stats?: RowKeyStats
): RowKeyResult {
  const cells = row.map((c) => (c ?? "").trim());
  const n = Math.max(1, stats?.rowCount ?? 1);
  const coverageOf = (i: number, v: string): number =>
    stats?.valueRowCount[i]?.get(v) ?? 1;
  // 覆盖率 > 1/3 且重复 ≥2 行 ⇒ 合并单元格式分组。
  const isGrouping = (i: number, v: string): boolean => {
    const cov = coverageOf(i, v);
    return cov > 1 && cov / n > 1 / 3;
  };
  const headerScore = (i: number): number => {
    const h = headers?.[i] ?? "";
    if (STRONG_NAME_HEADER.test(h)) return 2;
    if (WEAK_NAME_HEADER.test(h)) return 1.2;
    return 0.4;
  };

  const groupKeys = new Set<string>();
  const candidates: Array<{ v: string; i: number; score: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (!isNominalCell(v) || STRUCTURAL_LABEL.test(v)) continue;
    if (isTierLike(v)) continue; // 档位值只在兜底（rowKeyOf）里作主键
    if (isGrouping(i, v)) {
      // 仅名称型列的分组值值得留作别名（"列2""其中"这类结构垃圾不要）。
      if (headerScore(i) > 1) groupKeys.add(v);
      continue;
    }
    const specificity = 1 - (coverageOf(i, v) - 1) / n;
    const leftness = cells.length > 1 ? (cells.length - i) / cells.length : 1;
    candidates.push({ v, i, score: headerScore(i) + 2 * specificity + 0.6 * leftness });
  }
  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  // 兜底：没有唯一身份值（全分组/全档位）时退回旧的优先级规则。
  const rowKey = candidates[0]?.v ?? rowKeyOf(cells, headers);
  const groupList = [...groupKeys].filter((k) => k !== rowKey).slice(0, 3);
  return { rowKey, groupKeys: groupList };
}

/** 行 → 字段 JSON（列名→单元格值，跳过空）。 */
export function rowFields(
  headers: string[],
  row: string[]
): Record<string, string> {
  const fields: Record<string, string> = {};
  headers.forEach((h, i) => {
    const val = (row[i] ?? "").trim();
    if (h && val) fields[h] = val;
  });
  return fields;
}

/**
 * 行 → 自然语言展开（需求 4）：带表名与字段名。
 * 例："表1—1 综合服务类设施配置指标表。设施名称：物业服务用房。层级：项目级。
 *      一般规模-建筑面积：150。服务规模：每个项目1处。"
 */
export function expandRow(
  model: TableModel,
  row: string[],
  sectionPath?: string
): string {
  const parts: string[] = [];
  const head = [sectionPath, model.title].filter(Boolean).join(" ");
  if (head) parts.push(head);
  model.headers.forEach((h, i) => {
    const val = (row[i] ?? "").trim();
    if (h && val) parts.push(`${h}：${val}`);
  });
  return parts.join("。") + "。";
}
