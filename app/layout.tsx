import type { Metadata } from "next";
import "./globals.css";
import { KnowledgeUserProvider } from "@/components/KnowledgeUserProvider";
import { RootRouteShell } from "@/components/RootRouteShell";

export const metadata: Metadata = {
  title: "企业知识库 RAG｜文档问答与审计",
  description:
    "基于 Next.js 与 TypeScript 的企业知识库 RAG 问答项目，支持 PDF / Word 解析、表格检索、引用溯源、权限过滤、文档审计与问答评测。",
  keywords: ["企业知识库", "RAG", "文档问答", "PDF", "表格检索", "知识库问答", "enterprise knowledge base", "document QA", "企业知识库 RAG"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="bg-background">
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <KnowledgeUserProvider>
          <RootRouteShell>{children}</RootRouteShell>
        </KnowledgeUserProvider>
      </body>
    </html>
  );
}
