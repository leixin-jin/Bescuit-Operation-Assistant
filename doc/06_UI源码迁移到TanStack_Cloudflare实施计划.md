# 酒吧经营助手 UI 原型迁移到 TanStack Start + Cloudflare 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在尽量保留现有 UI 信息架构、文案和视觉语言的前提下，把当前 repository 中 `doc/UI源码` 里的 Next.js 原型迁移成可部署到 Cloudflare Workers 的 TanStack Start 全栈应用。

**Architecture:** 采用“新建 TanStack Start + Cloudflare 工程，再按页面和能力逐步搬运 UI”的路线，不在现有 Next 工程上硬改。前端路由和页面状态迁移到 TanStack Router / Query / Form；服务端能力收敛到 Cloudflare Workers + D1 + R2 + Queues + Workers AI。

**Tech Stack:** TanStack Start, TanStack Router, TanStack Query, TanStack Form, TanStack Table, Vite, `@cloudflare/vite-plugin`, Wrangler, Cloudflare Workers, D1, R2, Queues, Workers AI, Drizzle ORM, shadcn/ui, Tailwind CSS v4

---

## 1. 现有 UI 源码结构分析

### 1.1 当前工程的真实状态

源码目录：`/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant/doc/UI源码`

这不是一个“已经有业务后端的 Web App”，而是一个偏完整的交互原型。

从源码盘点得到的结论：

- 当前框架是 **Next.js App Router**，不是 Vite，也还没有 Cloudflare 运行时接入。
- `package.json` 里是 `next@16.2.0`、`react@19`、`tailwindcss@4`、`shadcn/ui + Radix` 组合。
- 页面入口一共 **5 个**：`/`、`/sales/new`、`/invoices/review`、`/analytics/monthly`、`/calendar`。
- `components/ui` 下有 **57 个** shadcn/radix 组件文件，可复用价值很高。
- `app/` 与 `components/` 里有 **49 个** `use client` 文件，说明当前几乎是“全客户端原型”。
- 没有 `app/api`、没有数据库 schema、没有 migration、没有 `wrangler.jsonc`、没有 Cloudflare bindings。
- 没有测试文件。
- `next.config.mjs` 里开启了 `typescript.ignoreBuildErrors = true`，这对原型阶段方便，但不适合迁移后的正式工程。
- `@vercel/analytics/next` 只适用于当前 Next/Vercel 形态，迁移后应移除或替换。

### 1.2 当前目录分层

```text
doc/UI源码/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── sales/new/page.tsx
│   ├── invoices/review/page.tsx
│   ├── analytics/monthly/page.tsx
│   ├── calendar/page.tsx
│   └── globals.css
├── components/
│   ├── app-shell.tsx
│   ├── app-sidebar.tsx
│   ├── metric-card.tsx
│   ├── theme-provider.tsx
│   └── ui/*
├── hooks/
│   ├── use-mobile.ts
│   └── use-toast.ts
├── lib/
│   └── utils.ts
├── public/
│   └── icons + placeholders
├── styles/
│   └── globals.css
└── package.json / tsconfig.json / next.config.mjs / postcss.config.mjs
```

### 1.3 哪些部分是“可迁移资产”

这些部分值得直接搬：

- `app/page.tsx` 的首页双卡入口和状态区思路，和现有业务文档一致。
- `app/sales/new/page.tsx` 的营业额录入表单布局，已经接近第一版产品形态。
- `app/invoices/review/page.tsx` 的左右对照工作台结构，适合作为发票 review workbench 的视觉母版。
- `components/app-shell.tsx` 和 `components/app-sidebar.tsx` 的内页壳子可以延用。
- `components/ui/*`、`lib/utils.ts`、`app/globals.css` 的设计令牌和基础样式可以延用。
- `metric-card.tsx`、图表卡片、标签、表格等展示组件可以继续用。

### 1.4 哪些部分不能 1:1 迁移

这些必须重写或至少重构：

- `app/layout.tsx`
  - 依赖 `next/font/google`、`Metadata`、`@vercel/analytics/next`，都是 Next 专属能力。
- `next/link`、`next/navigation`
  - 需要切换到 TanStack Router 的 `Link`、`useLocation` 或 `useRouterState`。
- 当前页面里的本地状态
  - `sales/new`、`invoices/review`、`calendar` 主要是 `useState + mock`，没有真实数据边界。
- 当前分析页和日历页的数据
  - `analytics/monthly` 是硬编码数组。
  - `calendar` 直接 `Math.random()` 生成假数据。
- 当前发票页
  - 把“上传、预览、编辑、映射、提交”混在一页里；在正式产品里应拆成 intake 和 review 两段流程。

### 1.5 已发现的源码问题

- `hooks/use-toast.ts` 与 `components/ui/use-toast.ts` 内容重复。
- `hooks/use-mobile.ts` 与 `components/ui/use-mobile.tsx` 内容重复。
- `styles/globals.css` 与 `app/globals.css` 内容重复，但实际只用了 `app/globals.css`。
- 侧边栏里有 `/settings` 链接，但没有对应页面。
- `layout.tsx` 把 `lang` 写成了 `en`，和中文业务场景不一致。

### 1.6 一句话判断

这份源码最有价值的是 **页面骨架、视觉组件和交互母版**；最没有价值的是 **运行时、数据层和框架绑定**。  
所以迁移应该是“保留 UI 资产，重建应用底座”，而不是“在当前 Next 项目里继续堆功能”。

## 2. 确定采用方案 B

### 在当前 repository 中建立 TanStack Start + Cloudflare 工程，再按页面搬运 UI

采用原因：

- 能直接按目标架构落地，不背 Next 历史包袱。
- 可以一开始就把 D1、R2、Queues、Workers AI、Drizzle、类型生成接好。
- 页面迁移可以按 route 粒度逐步完成，风险最可控。
- 现有 UI 原型已经把信息架构和交互方向试出来了，适合保留页面骨架和交互母版。
- 现有工程几乎没有可保留的数据层和运行时，继续在旧工程上硬迁移收益太低。

## 3. 目标架构与文件落点

以下 plan 假设迁移工作直接落在当前 repository 根目录：

`/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant`

也就是说：

- `doc/UI源码/` 保留为原型参考目录
- 新的 TanStack Start + Cloudflare 应用代码直接放在仓库根目录的 `src/`、`public/`、`migrations/` 等位置
- `doc/` 继续保存实施计划、设计说明和迁移文档

### 3.1 建议的新工程结构

```text
Bescuit-Operation-Assistant/
├── README.md
├── doc/
│   ├── 06_UI源码迁移到TanStack_Cloudflare实施计划.md
│   └── UI源码/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── wrangler.jsonc
├── drizzle.config.ts
├── migrations/
├── public/
├── src/
│   ├── routes/
│   │   ├── __root.tsx
│   │   ├── index.tsx
│   │   ├── sales/new.tsx
│   │   ├── invoices/new.tsx
│   │   ├── invoices/review/$jobId.tsx
│   │   ├── analytics/monthly.tsx
│   │   ├── analytics/calendar.tsx
│   │   └── calendar.tsx
│   ├── components/
│   │   ├── app-shell.tsx
│   │   ├── app-sidebar.tsx
│   │   ├── metric-card.tsx
│   │   └── ui/*
│   ├── hooks/
│   │   ├── use-mobile.ts
│   │   └── use-toast.ts
│   ├── features/
│   │   └── invoices/
│   │       ├── review-header-form.tsx
│   │       └── review-table.tsx
│   ├── styles/
│   │   └── globals.css
│   ├── lib/
│   │   ├── utils.ts
│   │   ├── env.ts
│   │   ├── db/
│   │   │   ├── client.ts
│   │   │   └── schema.ts
│   │   └── server/
│   │       ├── bindings.ts
│   │       ├── upload.ts
│   │       ├── queue.ts
│   │       ├── extraction.ts
│   │       ├── queries/
│   │       │   ├── dashboard.ts
│   │       │   ├── sales.ts
│   │       │   ├── invoices.ts
│   │       │   └── analytics.ts
│   │       └── mutations/
│   │           ├── sales.ts
│   │           └── invoices.ts
│   └── server.ts
```

### 3.2 当前页面到目标路由的映射

| 当前文件 | 当前 URL | 目标文件 | 目标 URL | 迁移说明 |
|---|---|---|---|---|
| `doc/UI源码/app/layout.tsx` | 全局 | `src/routes/__root.tsx` | 全局 | 用 TanStack Root Route 重建 head、CSS、脚本注入 |
| `doc/UI源码/app/page.tsx` | `/` | `src/routes/index.tsx` | `/` | 保留双卡首页结构，状态区改为 loader 数据 |
| `doc/UI源码/app/sales/new/page.tsx` | `/sales/new` | `src/routes/sales/new.tsx` | `/sales/new` | 用 TanStack Form + server mutation 重写提交逻辑 |
| `doc/UI源码/app/invoices/review/page.tsx` | `/invoices/review` | `src/routes/invoices/review/$jobId.tsx` | `/invoices/review/$jobId` | 当前页面更像“单张发票校对台”，适合挂到 job 维度 |
| 无 | 无 | `src/routes/invoices/new.tsx` | `/invoices/new` | 新增 intake 页，负责上传和创建 intake job |
| `doc/UI源码/app/analytics/monthly/page.tsx` | `/analytics/monthly` | `src/routes/analytics/monthly.tsx` | `/analytics/monthly` | 保留视觉形式，数据改为 D1 聚合 |
| `doc/UI源码/app/calendar/page.tsx` | `/calendar` | `src/routes/analytics/calendar.tsx` | `/analytics/calendar` | 日历应归入 analytics 命名空间 |
| 无 | `/calendar` | `src/routes/calendar.tsx` | `/calendar` | 临时做 redirect，兼容旧入口 |

### 3.3 TanStack 各库应该怎么用

- TanStack Router
  - 负责文件路由、导航、嵌套路由、layout 和页面 head。
- TanStack Start
  - 负责 route loader、server functions、SSR 和 Worker 入口整合。
- TanStack Query
  - 负责首页状态、review 台数据、分析页聚合数据的获取、缓存和失效。
- TanStack Form
  - 用在 `sales/new` 和发票 header / line items 编辑。
- TanStack Table
  - 只放在发票行项目表、原料主表、后续队列表格。
  - 不要把简单卡片页也强行改成 Table。

### 3.4 Cloudflare bindings 目标配置

迁移后建议至少有这些 bindings：

- `DB`
  - D1 主数据库，保存 `sales_daily`、`invoices`、`invoice_items`、`ingredients` 等事实数据。
- `RAW_DOCUMENTS`
  - R2 桶，保存原始票据图片、PDF、JSON、转换产物。
- `INTAKE_QUEUE`
  - Queue producer，提交解析任务。
- `bescuit-operation-assistant-intake`
  - Queue consumer，异步执行解析和入库。
- `AI`
  - Workers AI binding，作为默认文档抽取层。

示意 `wrangler.jsonc`：

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "bescuit-operation-assistant",
  "main": "./src/server.ts",
  "compatibility_date": "2026-04-23",
  "ai": {
    "binding": "AI"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "bescuit-operation-assistant-db",
      "database_id": "REPLACE_ME",
      "migrations_dir": "./migrations"
    }
  ],
  "r2_buckets": [
    {
      "binding": "RAW_DOCUMENTS",
      "bucket_name": "bescuit-operation-assistant-raw-documents"
    }
  ],
  "queues": {
    "producers": [
      {
        "binding": "INTAKE_QUEUE",
        "queue": "bescuit-operation-assistant-intake"
      }
    ],
    "consumers": [
      {
        "queue": "bescuit-operation-assistant-intake",
        "max_batch_size": 5,
        "max_batch_timeout": 10,
        "max_retries": 5,
        "dead_letter_queue": "bescuit-operation-assistant-intake-dlq"
      }
    ]
  }
}
```

## 4. 迁移实施计划

### Task 1: 搭建新的 TanStack Start + Cloudflare 底座

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `wrangler.jsonc`
- Create: `src/routes/__root.tsx`
- Create: `src/server.ts`
- Create: `src/lib/env.ts`
- Reference: `doc/UI源码/package.json`
- Reference: `doc/UI源码/app/layout.tsx`

- [ ] **Step 1: 先在临时目录生成 TanStack Start 脚手架，再并入当前 repository 根目录**

Run:

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
mkdir -p .tmp
cd .tmp
npx @tanstack/cli@latest create bescuit-operation-assistant-app
```

Expected:
- 选择 React + Start + file-based routing
- 先在 `.tmp/bescuit-operation-assistant-app/` 生成干净脚手架
- 再把应用文件合并到当前 repository 根目录，保留已有 `doc/` 文档目录不动

- [ ] **Step 2: 安装 Cloudflare 侧依赖**

Run:

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
pnpm add @tanstack/react-query @tanstack/react-form @tanstack/react-table drizzle-orm
pnpm add -D @cloudflare/vite-plugin wrangler drizzle-kit
```

Expected:
- 新工程具备 TanStack 数据层和 Cloudflare 部署能力

- [ ] **Step 3: 把 Vite 改成 Cloudflare SSR 形态**

`vite.config.ts` 至少要满足这个结构：

```ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    react(),
  ],
})
```

- [ ] **Step 4: 配置 scripts 和 Wrangler**

`package.json` 需要至少包含：

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build && tsc --noEmit",
    "preview": "vite preview",
    "deploy": "pnpm build && wrangler deploy",
    "cf-typegen": "wrangler types"
  }
}
```

- [ ] **Step 5: 生成 Cloudflare bindings 类型**

Run:

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
pnpm cf-typegen
```

Expected:
- 生成 bindings 类型文件
- 后续 server code 不再手写 `env` 类型

### Task 2: 搬运设计系统与公共组件，不搬 Next 专属运行时

**Files:**
- Create: `src/components/**/*`
- Create: `src/hooks/use-mobile.ts`
- Create: `src/hooks/use-toast.ts`
- Create: `src/lib/utils.ts`
- Create: `src/styles/globals.css`
- Reference: `doc/UI源码/components/**/*`
- Reference: `doc/UI源码/hooks/*`
- Reference: `doc/UI源码/app/globals.css`
- Reference: `doc/UI源码/styles/globals.css`

- [ ] **Step 1: 直接复制可复用 UI 资产**

复制这些目录和文件：

- `doc/UI源码/components/ui/*`
- `doc/UI源码/components/app-shell.tsx`
- `doc/UI源码/components/app-sidebar.tsx`
- `doc/UI源码/components/metric-card.tsx`
- `doc/UI源码/lib/utils.ts`
- `doc/UI源码/public/*`

- [ ] **Step 2: 去掉重复实现，只保留一份 hooks**

保留：

- `src/hooks/use-mobile.ts`
- `src/hooks/use-toast.ts`

不要再同时保留：

- `src/components/ui/use-mobile.tsx`
- `src/components/ui/use-toast.ts`

- [ ] **Step 3: 合并全局样式，只保留一份 `globals.css`**

当前两个文件内容重复：

- `doc/UI源码/app/globals.css`
- `doc/UI源码/styles/globals.css`

迁移后统一保留：

- `src/styles/globals.css`

- [ ] **Step 4: 在 Root Route 接入全局样式和页面外壳**

`src/routes/__root.tsx` 的骨架应类似：

```tsx
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import appCss from '../styles/globals.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '酒吧经营助手 | Bar Operations Assistant' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
```

- [ ] **Step 5: 明确不迁这些 Next 专属内容**

不要继续带入：

- `next/font/google`
- `@vercel/analytics/next`
- `next.config.mjs`
- `typescript.ignoreBuildErrors = true`

### Task 3: 先做静态页面迁移，建立 TanStack 路由骨架

**Files:**
- Create: `src/routes/index.tsx`
- Create: `src/routes/sales/new.tsx`
- Create: `src/routes/analytics/monthly.tsx`
- Create: `src/routes/analytics/calendar.tsx`
- Create: `src/routes/calendar.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Reference: `doc/UI源码/app/page.tsx`
- Reference: `doc/UI源码/app/sales/new/page.tsx`
- Reference: `doc/UI源码/app/analytics/monthly/page.tsx`
- Reference: `doc/UI源码/app/calendar/page.tsx`

- [ ] **Step 1: 把首页先原样迁到 TanStack 路由**

迁移规则：

- `next/link` 改成 `@tanstack/react-router` 的 `Link`
- footer 状态先保留占位，但数据来源以后改 loader
- 页面布局保持不变

示意：

```tsx
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})
```

- [ ] **Step 2: 把营业额录入页迁成独立 route**

迁移目标：

- 先保留当前表单样式和渠道字段
- 把 `useState + useMemo` 暂时保留为第一步
- 第二步再替换成 TanStack Form

- [ ] **Step 3: 把月分析页迁到 `analytics/monthly`**

迁移目标：

- 暂时保留视觉层和 mock 卡片
- 不要在这一阶段引入真实 SQL 聚合
- 先把路由和组件边界跑通

- [ ] **Step 4: 把日历页迁到 `analytics/calendar`，并保留旧 URL redirect**

目标：

- `src/routes/analytics/calendar.tsx` 作为正式页面
- `src/routes/calendar.tsx` 只做兼容跳转

- [ ] **Step 5: 修正 sidebar 导航**

处理规则：

- 把所有 `next/link` 改成 TanStack `Link`
- `usePathname()` 改成 `useLocation()` 或 router state
- `/settings` 先去掉，或补一个明确的占位页，不要保留死链接

### Task 4: 重构发票页面，把“上传入口”和“校对工作台”拆开

**Files:**
- Create: `src/routes/invoices/new.tsx`
- Create: `src/routes/invoices/review/$jobId.tsx`
- Create: `src/features/invoices/review-table.tsx`
- Create: `src/features/invoices/review-header-form.tsx`
- Reference: `doc/UI源码/app/invoices/review/page.tsx`

- [ ] **Step 1: 不直接复刻现有 `/invoices/review` 路由**

原因：

- 当前页面同时承担了上传、预览、编辑、映射、提交 5 件事
- 这更像具体某个 intake job 的 review workbench

- [ ] **Step 2: 新增 `invoices/new` 作为 intake 页**

这个页面只做：

- 上传图片 / PDF / JSON
- 创建 intake job
- 成功后跳到 `/invoices/review/$jobId`

- [ ] **Step 3: 把当前两栏工作台迁到 `invoices/review/$jobId`**

左栏保留：

- 文件预览
- 缩放 / 翻页
- 上传替换

右栏保留：

- 发票头部字段编辑
- 行项目表格
- 原料映射
- 保存 / 确认入账

- [ ] **Step 4: 用组件拆开当前大文件**

当前 `doc/UI源码/app/invoices/review/page.tsx` 太大，迁移后至少拆成：

- `review-header-form.tsx`
- `review-table.tsx`
- 页面 route 文件只负责 loader / mutation / 组合

### Task 5: 建立 D1 数据模型和 server query/mutation 边界

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/server/queries/dashboard.ts`
- Create: `src/lib/server/queries/sales.ts`
- Create: `src/lib/server/queries/invoices.ts`
- Create: `src/lib/server/queries/analytics.ts`
- Create: `src/lib/server/mutations/sales.ts`
- Create: `src/lib/server/mutations/invoices.ts`
- Create: `migrations/*`
- Reference: `doc/05_Web_App_开发计划_Cloudflare_TanStack.md`

- [ ] **Step 1: 先建最小可跑的数据表，不要一口气全量建模**

第一批表建议只建：

- `sales_daily`
- `source_documents`
- `intake_jobs`
- `extraction_results`
- `invoices`
- `invoice_items`
- `ledger_entries`
- `ingredients`
- `ingredient_aliases`

- [ ] **Step 2: 把 SQL/ORM 操作集中到 query/mutation 文件**

规则：

- route 文件不直接写 SQL
- loader 只调用 `queries/*`
- 表单提交只调用 `mutations/*`

- [ ] **Step 3: 首页和分析页先消费聚合 query**

首页至少需要：

- 今日营业额是否已录
- 待确认发票数量
- 本月发票数量

月分析页至少需要：

- 月收入结构
- 月支出结构
- 周趋势

- [ ] **Step 4: 不把 mock 数据继续留在 route 文件**

迁移完成后，要删掉：

- `incomeData`
- `expenseData`
- `weeklyData`
- `mockLineItems`
- `generateMockData`

### Task 6: 接入 Cloudflare 专属能力，补齐上传和异步解析链路

**Files:**
- Create: `src/server.ts`
- Create: `src/lib/server/bindings.ts`
- Create: `src/lib/server/upload.ts`
- Create: `src/lib/server/queue.ts`
- Create: `src/lib/server/extraction.ts`
- Modify: `wrangler.jsonc`

- [ ] **Step 1: 用自定义 `server.ts` 承接 Worker 入口**

骨架应类似：

```ts
import handler from '@tanstack/react-start/server-entry'

export default {
  fetch: handler.fetch,
  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      // 读取 intake job，执行解析，更新 D1 状态
      message.ack()
    }
  },
}
```

- [ ] **Step 2: 上传文件时先落 R2，再写 D1，再发 Queue**

顺序固定为：

1. 文件写入 `RAW_DOCUMENTS`
2. 插入 `source_documents`
3. 插入 `intake_jobs`
4. 发送 `INTAKE_QUEUE`
5. 返回 `jobId`

- [ ] **Step 3: 解析层不要直接“识别成最终发票”**

保持和现有业务文档一致：

1. 先做文档规范化
2. 再做结构化字段抽取
3. 再做人工 review
4. 最后才入账

- [ ] **Step 4: 在 server-side 代码中通过 bindings 访问 Cloudflare 能力**

示意：

```ts
import { env } from 'cloudflare:workers'
```

用途：

- `env.DB`
- `env.RAW_DOCUMENTS`
- `env.INTAKE_QUEUE`
- `env.AI`

### Task 7: 把页面状态从本地 mock 切换成 TanStack Query / Form

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/sales/new.tsx`
- Modify: `src/routes/invoices/review/$jobId.tsx`
- Modify: `src/routes/analytics/monthly.tsx`
- Modify: `src/routes/analytics/calendar.tsx`

- [ ] **Step 1: 首页改成 loader + Query 混合模式**

规则：

- 首屏关键数据走 route loader
- 需要提交后刷新的状态走 TanStack Query

- [ ] **Step 2: `sales/new` 改成 TanStack Form**

至少包含：

- 业务日期
- `bbva`
- `caixa`
- `efectivo`
- 备注

提交后：

- 写入 `sales_daily`
- 失效首页 summary query
- 回显成功 toast

- [ ] **Step 3: `invoices/review/$jobId` 改成 Query + Form + Table**

规则：

- 发票头部编辑用 Form
- 行项目表格用 Table
- 保存和确认动作用 mutation

- [ ] **Step 4: 分析页和日历页全部改成真实聚合**

不要保留：

- 手工常量图表数据
- `Math.random()`
- 仅用于演示的 hard-coded 数字

### Task 8: 验证、部署和切换

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Reference: `doc/UI源码/`

- [ ] **Step 1: 建立最基本的质量门禁**

至少执行：

```bash
pnpm build
pnpm cf-typegen
pnpm deploy
```

迁移完成前不再允许：

- 忽略 TypeScript build errors
- 页面还依赖 mock 数据却宣称可上线

- [ ] **Step 2: 创建 Cloudflare 资源**

Run:

```bash
pnpm wrangler d1 create bescuit-operation-assistant-db
pnpm wrangler r2 bucket create bescuit-operation-assistant-raw-documents
pnpm wrangler queues create bescuit-operation-assistant-intake
pnpm wrangler queues create bescuit-operation-assistant-intake-dlq
```

Expected:
- 得到真实 `database_id`
- 更新 `wrangler.jsonc`

- [ ] **Step 3: 做最小 smoke test**

至少验证这 4 条链路：

1. 首页能正常展示 summary
2. 营业额录入后首页状态能刷新
3. 上传一张票据后能创建 intake job 并进入 review 页
4. 月分析和日历页不再显示随机数据

- [ ] **Step 4: 只有在新工程跑通后，才处理旧 `doc/UI源码`**

处理方式：

- 保留为 `prototype/` 参考目录
- 或在新工程稳定后归档

不要在迁移中途直接删掉原型源码。

## 5. 迁移优先级建议

建议按这个顺序推进：

1. 新工程底座
2. 全局样式和共享组件
3. 首页 + 营业额页
4. 发票 intake / review 流程
5. D1/R2/Queue/AI 接入
6. 分析页和日历页
7. 验证和部署

原因：

- 首页和营业额页依赖最少，最适合先验证 UI 搬运是否顺利。
- 发票 review 是第一版最关键能力，但它依赖上传、job、存储和数据模型，不应该第一步就做。
- 分析页和日历页必须放在真实数据层之后，否则只是在迁移假图表。

## 6. 最终结论

这次迁移不该理解成“把 Next.js 改成 TanStack Start”。

更准确地说，它是三件事一起发生：

- 把 `doc/UI源码` 从 **Next 原型** 提炼成 **可复用 UI 资产**
- 把页面从 **本地 mock 状态** 升级成 **TanStack 的路由 + 数据 + 表单结构**
- 把应用从 **纯前端演示** 升级成 **Cloudflare Workers 上的全栈系统**

如果只想找一个最稳的执行口径，就是：

**以当前 `Bescuit-Operation-Assistant` repository 根目录作为目标工程，先搬视觉和壳子，再一页一页接 TanStack Router / Query / Form，最后补 D1、R2、Queue 和 Workers AI。**

## 7. 技术依据

以下内容已按 **2026-04-23** 的官方文档做过校验：

- TanStack Start Cloudflare hosting: [https://tanstack.com/start/latest/docs/framework/react/guide/hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- TanStack Start migrate from Next.js: [https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js](https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js)
- Cloudflare TanStack Start framework guide: [https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)
- Cloudflare D1 bindings: [https://developers.cloudflare.com/d1/](https://developers.cloudflare.com/d1/)
- Cloudflare R2 bindings: [https://developers.cloudflare.com/r2/](https://developers.cloudflare.com/r2/)
- Cloudflare Queues config: [https://developers.cloudflare.com/queues/](https://developers.cloudflare.com/queues/)
- Cloudflare Workers AI bindings: [https://developers.cloudflare.com/workers-ai/](https://developers.cloudflare.com/workers-ai/)
