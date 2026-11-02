# 技术方案｜DesignBase RAG 企业知识库

> 阶段 4（技术设计）· 架构 / 选型 / 数据模型 / 检索算法 / 接口 / 部署
> 最后更新：2026-06-21 ｜ 关联：[PRD](./PRD.md) · [原型与流程](./prototype.md)
>
> 所有声明对齐当前实现；文件路径为实际锚点。

---

## 1. 架构总览

单体 Next.js 14（App Router）应用，前端页面 + API Route + 业务库同仓。无独立后端服务，
重活（解析/检索/生成）在 Next.js 服务端运行；表格抽取通过 Python 边车进程外调。

```
┌────────────── 浏览器 ──────────────┐
│ app/ 页面 (RSC + "use client" 组件) │
│  ChatPanel / DocumentTable / …      │
└───────────────┬────────────────────┘
                │ fetch
┌───────────────▼──────────── Next.js 服务端 ─────────────────────┐
│ app/api/*  (Route Handlers)                                     │
│   chat / documents / evaluation / feedback / retrieve-debug …   │
├─────────────────────────────────────────────────────────────────┤
│ lib/ 业务层                                                      │
│   rag/      检索·重排·拒答·表格装配·回答编排                       │
│   parse/    文本提取·IR·表格识别 (调用 Python 边车)               │
│   knowledge/ 权限·导航·无权处理                                  │
│   ai/       LLMProvider · EmbeddingProvider (可替换/可mock)      │
│   db/       内存索引 + .data 文件持久化 + mockData               │
└───────────────┬─────────────────────────┬───────────────────────┘
                │ 进程外调用                │ HTTP (OpenAI 兼容)
        ┌───────▼────────┐        ┌────────▼─────────┐
        │ Python 边车     │        │ 智谱 GLM / mock  │
        │ pdfplumber 抽表 │        │ LLM + Embedding  │
        └────────────────┘        └──────────────────┘
```

### 分层职责
| 层 | 目录 | 职责 |
| --- | --- | --- |
| 表现层 | `app/`、`components/` | 页面、组件、客户端状态（身份上下文、历史） |
| 接口层 | `app/api/` | 请求校验、调用业务层、返回 JSON |
| 业务层 | `lib/rag`、`lib/parse`、`lib/knowledge` | RAG 链路、解析流水线、权限 |
| 能力层 | `lib/ai` | LLM / Embedding 抽象，真实/ mock 双实现 |
| 数据层 | `lib/db` | Chunk / Document 存取（内存索引 + 本地文件持久化） |

---

## 2. 技术选型与理由

| 维度 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | Next.js 14 (App Router) | 前后端一体、Route Handler 即 API，支持本地 Node.js 运行 |
| 语言 | TypeScript 5.6 | 全链路类型安全，`lib/types.ts` 为单一事实源 |
| UI | Tailwind + Radix UI | 无障碍基础组件 + 原子化样式，`components/ui/` 封装 |
| PDF 文本 | pdfjs-dist | 纯 JS，可在 Node 端跑，取文本与坐标 |
| PDF 表格 | pdfplumber（Python 边车） | 表格抽取精度高于纯 JS；缺失则降级（见风险） |
| Word | mammoth | docx → 结构化 HTML/文本 |
| 检索 | 自研：精确索引 + BM25 + 余弦向量 | 规范场景需精确整词命中（用地代码/条款号），非纯向量可覆盖 |
| AI | OpenAI 兼容接口（默认智谱 GLM） | 接口通用、可替换；无 Key 时走 mock 全链路可演示 |

---

## 3. 数据模型（核心类型，见 `lib/types.ts`）

```
Document            文档元数据（fileName/category/permissionLevel/projectId/
                    projectOwnerId/accessibleUserIds/enabled/status）
   └─ status: pending | processing | indexed | failed
Block (IR)          解析中间表示：heading|paragraph|list_item|table|table_row|
                    page_break|image_page
KnowledgeObject     14 类结构化知识对象（条款/指标/定义/成果要求/流程步骤/用地代码…）
Chunk               检索单元：含 content / embedding / sectionPath / articleNo /
                    pageNumber / documentId / 表格归属信息
RagTable            表格一级对象：列定义 + 行（独立存储，命中后精确截取渲染）
RetrievedChunk      检索结果：chunk + keywordScore/vectorScore/rerankScore/source/
                    matchedKeywords
```

**权限相关字段**（决定可见性，见 `lib/knowledge/permissions.ts`）：
- `permissionLevel: 1|2|3`（L1 公开 / L2 项目主管 / L3 管理员）
- 项目绑定：`projectId` / `projectOwnerId` / `accessibleUserIds`
- 用户侧：`role` + `projectIds`（被授权）+ `ownedProjectIds`（负责）

---

## 4. 检索算法（`lib/rag/retrieve.ts`）

### 4.1 流程
```
1. listSearchableChunksByAccess(city,userId,role)
      → { accessible, denied }   ← 权限过滤发生在最前
2. extractQueryKeywords(question)  ← 用地代码/数值/条款号/术语/2-gram 兜底
3. 对 accessible 跑三路检索 searchChunkSet:
      · exactSearchChunks   精确整词索引
      · BM25Index.search    关键词（去单字中文噪声，归一化到[0,1]）
      · vectorSearch        问题 embedding × chunk 余弦（维度不一致跳过+告警）
   → 按 chunk.id 合并，命中多路者 source="hybrid"
4. rerank(merged, {question,keywords,city})
      多维信号：IDF短语 / 意图 / 版本时效 / 来源标题加权 …
5. topK = topKForQuerySignals(analyzeQuery(question))  ← 动态 Top-K
6. expandHit: table_row/code 补表头+表名；clause 补章节路径
7. limitContextBudget: ≤12000 字符，但至少保留 5 条
8. 对 denied 单独跑同样检索 → deniedTop（仅用于「无权 vs 无依据」判定，不进上下文）
```

### 4.2 关键设计点
- **权限最前置**：`accessible` / `denied` 在检索入口就分流，无权 chunk 永不进入打分上下文。
- **精确通道不可替代**：用地代码（`H9`/`R类`）、条款号（`第十二条`）必须整词命中，纯向量会漏。
- **向量维度自检**：库内向量与当前 embedding 提供方维度不一致时跳过并 `console.warn`，避免「向量通道静默全灭」。
- **denied 仍检索**：为区分「你无权看」与「知识库没有」，对无权集合也检索，命中则走权限提示而非拒答。

---

## 5. AI 能力抽象（`lib/ai`）

```ts
interface LLMProvider {
  name: string;
  synthesizeConclusion(input: SynthesizeInput): Promise<string>; // 仅生成【结论】正文
}
interface EmbeddingProvider {
  embed(text): Promise<number[]>;
  signature: string; // 维度自检用
}
```
- **可替换**：`getLLMProvider()` / `getEmbeddingProvider()` 按环境切换真实 / mock。
- **mock 抽取式 LLM**：只复述传入 chunks 原文，绝不引入模型常识——这是产品安全底线，也让无 Key 时可完整演示。
- **强约束 SYSTEM_PROMPT**（真实 LLM）：只输出【结论】、不得编造文件名/条款/数值、不得用「通常为/一般来说」、涉及冲突判断/审批结论/CAD-GIS 解析一律拒答。
- **用量追踪**：`lib/ai/usage.ts` 统计真实 API 调用 / 估算 token。

---

## 6. API 设计（`app/api/`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/chat` | 问答主链路（question/city/userId/userRole）→ ChatResponse |
| POST | `/api/feedback` | 保存反馈（按 feedbackTargetId） |
| GET | `/api/documents` | 文档列表（按 ACL 过滤） |
| POST | `/api/documents/upload` | 上传文档 |
| POST | `/api/documents/:id/process` | 解析→切片→embedding→入库 |
| PATCH/DELETE | `/api/documents/:id` | 更新元数据 / 切检索开关 / 删除 |
| GET | `/api/documents/:id/chunks` | 查看文档切片 |
| POST | `/api/retrieve-debug` | 检索调试（三路得分） |
| GET/POST | `/api/evaluation` | 题库管理与评测运行 |
| GET | `/api/debug/tables`、`/api/debug/overlay` | 表格抽取调试 |

**统一约定**：入参缺失返回 400；ChatResponse 含 `answer / foundEvidence / citations / answerBlocks / confidence / feedbackTargetId`。

---

## 7. 配置与部署

| 配置 | 说明 |
| --- | --- |
| 无 AI Key | 默认 mock LLM + mock Embedding，全链路可跑（演示/评测） |
| `ZHIPU_API_KEY` 等 | 接入真实智谱 GLM（OpenAI 兼容） |
| `OCR_SCANNED=1` | 开启 Tesseract OCR（扫描件文字，默认关） |
| `VISION_SCANNED=1` | 开启 GLM-4V 视觉识别（复杂扫描表格，需 Key，默认关） |
| 开发工具入口 | `canUseDeveloperTools` 按角色判断，管理员与开发人员可见 |
| 端口 | 开发 `npm run dev` 使用 3100；构建后 `npm start` 使用 Next.js 默认端口，可用 `PORT` 环境变量指定 |
| Vercel | `vercel.json` 设置 `git.deploymentEnabled: false`，关闭 Git 自动部署 |

运行入口与克隆命令见[项目 README](../README.md)。依赖 Node.js 22.13+ 或 24；Python（pdfplumber 边车）用于表格抽取增强，缺失则降级。当前以本地运行和代码展示为主。

---

## 8. 测试与质量门

| 手段 | 命令 | 现状 |
| --- | --- | --- |
| 单元测试 | `npm test`（node --experimental-strip-types） | 结果与数量以当前运行输出为准 |
| 类型检查 | `npx tsc --noEmit` | 校验当前代码的类型约束 |
| 构建验证 | `npm run build` | 编译、类型检查与路由生成 |
| 代码检查 | `npm run lint` | 使用 Next.js ESLint 配置 |
| 表格对比 | `npm run compare:tables` | 坐标表抽取回归 |
| 真实 PDF 评测 | `npm run eval:real-pdfs` | 真实样本评测 |

测试覆盖重点：权限分流（`splitChunksByUserAccess`）、无权不泄露、文档管理权限、表格解析、评测导入导出。

---

## 9. 已知技术债 / 风险
| 编号 | 项 | 影响 | 建议 |
| --- | --- | --- | --- |
| TD-1 | 本地文件持久化 | 依赖持久磁盘，不支持多实例共享数据库 | 接 DB（文档/Chunk/向量）并规划备份 |
| TD-2 | 模拟账号，无真实鉴权 | 仅演示 | 接企业 SSO / 鉴权中间件 |
| TD-3 | 缺少自动代码检查流水线 | 已配置 ESLint，但仍需手动运行 | 将 `npm run lint` 纳入后续 CI |
| TD-4 | 无 CI 门禁 | 回归靠手动三件套 | GitHub Actions: lint+test+build |
| TD-5 | Python 边车硬依赖 | 缺失则表格降级 | 部署文档明确依赖 / 容器内置 |
| TD-6 | 向量维度耦合提供方 | 换 embedding 需重建向量 | 入库记录 signature，换源时提示重解析 |

---

## 10. 表格结构修复与显式重处理

### 10.1 解析模型

Python sidecar 输出 `RawTableV2`，其中包含单元格 bbox、显式行列 span、字符来源顺序、物理网格证据和未归属碎片。Node 侧规范化为 `CanonicalTable`：

- 仅由物理跨度传播合并单元格值；
- 对明显碎片化且跨行不稳定的纵向边界折叠“幽灵列”；
- 结构证据不足时守恒回退为段落；
- 跨页合并要求列数、归一化边界与表头/续表标题同时兼容；
- 每个 CanonicalRow 保留原始 `sourcePage`。

真实 PDF 金样覆盖伪表格、行边界、合并单元格和跨页续表四类代表性问题，同时保留合法多列表和不兼容相邻表负例。

### 10.2 prepare / diff / publish

显式重处理 staging 位于 `.data/reprocess/{docId}/{stagingId}/`，包含：

- `chunks.json`、`ragtables.json`；
- `manifest.json`（源文件、基线、目标 SHA-256）；
- `diff.json`（Chunk/RagTable 数量及逐表变化）；
- `preparation.json` 与 `transaction.json`。

`prepare` 不写活动索引；`publish` 检查源文件和活动基线未漂移后，按文档切片替换 Chunk/RagTable。跨文件事务通过旧/目标切片日志实现：部分写入失败立即回滚；启动恢复遇到 `applying` 时，若目标双哈希均匹配则提交，否则恢复旧切片。API 沿用文档管理权限，禁止普通用户发布。
