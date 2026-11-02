# DesignBase RAG｜企业知识库产品与技术文档

本目录介绍 **DesignBase RAG（Enterprise RAG Knowledge Base）**：以规划设计行业资料为示例的企业知识库问答与文档审计项目。

仓库：[SherlockMF/enterprise-rag-knowledge-base](https://github.com/SherlockMF/enterprise-rag-knowledge-base) · [本地启动与功能总览](../README.md)

首次了解项目，可先看[项目简介](./one-pager.md)和[案例介绍](./case-study.md)；准备运行可看[演示脚本](./demo-script.md)；准备开发可看[技术方案](./tech-design.md)。下表按产品构建生命周期组织。

| 阶段 | 文档 | 回答的问题 |
| --- | --- | --- |
| 0 概念 | [one-pager.md](./one-pager.md) | 为谁解决什么？为什么是现在？ |
| 1 调研 | [research.md](./research.md) | 用户是谁？旅程如何？竞品差距在哪？ |
| 2 需求 | [PRD.md](./PRD.md) | 做哪些功能？验收标准是什么？ |
| 3 原型/流程 | [prototype.md](./prototype.md) | 长什么样？数据与交互如何流转？ |
| 4 技术方案 | [tech-design.md](./tech-design.md) | 怎么实现？架构与选型取舍？ |
| 5 Demo | [本地运行](../README.md#快速开始) · [演示脚本](./demo-script.md) | 最小闭环能验证假设吗？ |
| 6 验证/迭代 | [evaluation-plan.md](./evaluation-plan.md) | 效果达标吗？怎么量化回归？ |

## 两条贯穿全程的「黄金线」
- **验收标准线**：PRD 的每条验收标准（AC-1~AC-6）→ 在 evaluation-plan 的场景矩阵中都有对应项。
- **可演示线**：无 AI Key 时用内置 mock 全链路跑通，保证任何阶段都能即时演示。

## 专题文档

- [AI 风险与产品对策](./ai-risk-control.md)：幻觉、权限、引用与表格数值风险。
- [质量指标说明](./metrics-report.md)：召回、引用、拒答和权限隔离的评测口径。
- [自动审核试点记录](./auto-review-pilot-runbook.md)：历史试点过程与复核记录。
- `superpowers/specs/` 与 `superpowers/plans/` 保存历史设计和实施计划，日期、分支与验证记录按当时状态保留。

当前采用本地运行；Vercel Git 自动部署已在仓库配置中关闭。运行要求、数据存储边界与命令以[根目录 README](../README.md)为入口。

> 文档基于现有实现反推整理，所有技术声明对齐代码（路径为实际锚点）。
> 实现演进时请同步更新对应文档，保持「写下的需求」与「运行的行为」一致。
