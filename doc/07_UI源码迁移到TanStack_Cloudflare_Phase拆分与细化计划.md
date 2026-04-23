# UI源码迁移到 TanStack Start + Cloudflare Phase 拆分与细化执行计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于现有 [06_UI源码迁移到TanStack_Cloudflare实施计划](./06_UI源码迁移到TanStack_Cloudflare实施计划.md)，把迁移工作重组为清晰的 phase，并补齐更细的执行步骤、文件范围、依赖关系和验收标准。

**Architecture:** 保留 `doc/UI源码` 作为原型参考目录，新的 TanStack Start + Cloudflare 应用直接落在当前 repository 根目录。迁移顺序采用“先底座、再壳子、再静态页面、再数据与异步链路、最后切换真实数据和部署”的渐进式路径，避免一次性重写。

**Tech Stack:** TanStack Start, TanStack Router, TanStack Query, TanStack Form, TanStack Table, Vite, Cloudflare Workers, Wrangler, D1, R2, Queues, Workers AI, Drizzle ORM, shadcn/ui, Tailwind CSS v4

---

## 1. Phase 总览

| Phase | 对应原计划 | 目标 | 完成标志 |
|---|---|---|---|
| Phase 0 | 原计划第 1-3 节 | 锁定迁移边界、目标目录和文件职责 | 所有目标文件路径和阶段依赖明确 |
| Phase 1 | Task 1 | 建立 TanStack Start + Cloudflare 底座 | `pnpm build`、`pnpm cf-typegen` 可运行 |
| Phase 2 | Task 2 | 搬运设计系统与应用外壳 | `src/routes/__root.tsx` 能渲染全局样式和壳子 |
| Phase 3 | Task 3 | 建立静态路由骨架并迁移首页/营业额/分析页 | 目标页面可无 mock API 运行 |
| Phase 4 | Task 4 | 拆分发票 intake 与 review 工作台 | `/invoices/new` 和 `/invoices/review/$jobId` 路由成型 |
| Phase 5 | Task 5 | 建立 D1 schema 与 query/mutation 边界 | route 不再直接承载 mock 数据模型 |
| Phase 6 | Task 6 | 接入上传、R2、Queue、Workers AI 链路 | intake job 可形成完整异步处理链 |
| Phase 7 | Task 7 | 把页面改接真实 loader / Query / Form | 首页、营业额、发票、分析页不再依赖本地 mock |
| Phase 8 | Task 8 | 验证、部署、切换与原型归档 | 新工程具备最小上线条件 |

## 2. 目标文件分层

- `doc/UI源码/`
  - 仅作迁移参考，不继续演化为正式工程。
- `src/routes/`
  - 负责页面路由、loader、head、页面组合。
- `src/components/`
  - 负责可复用 UI 组件和应用外壳。
- `src/features/`
  - 负责中等粒度业务组件，尤其是发票 review 工作台。
- `src/lib/db/`
  - 负责 Drizzle schema、D1 client。
- `src/lib/server/queries/`
  - 负责只读聚合查询。
- `src/lib/server/mutations/`
  - 负责写操作与状态转换。
- `src/lib/server/`
  - 负责 bindings、上传、队列、抽取流程。
- `public/`
  - 负责图标、占位图等静态资产。
- `migrations/`
  - 负责 D1 schema migration 文件。

## 3. 详细 Phase 计划

### Phase 0: 锁定迁移边界与仓库策略

**对应原计划：** 第 1-3 节  
**依赖：** 无  
**完成标准：**
- 目标工程明确为当前 repository 根目录
- `doc/UI源码` 明确为原型参考目录
- 各目录职责和 phase 依赖固定

**Files:**
- Reference: `doc/06_UI源码迁移到TanStack_Cloudflare实施计划.md`
- Create: `doc/07_UI源码迁移到TanStack_Cloudflare_Phase拆分与细化计划.md`

- [x] **Step 1: 锁定迁移源目录**
  - 迁移源只认 `doc/UI源码/`，不再引用外部 OneDrive 路径或其它临时目录。

- [x] **Step 2: 锁定目标工程目录**
  - 正式应用代码统一落在 repository 根目录下的 `src/`、`public/`、`migrations/`、`package.json`、`wrangler.jsonc`。

- [x] **Step 3: 锁定原型保留策略**
  - 在新工程未通过 smoke test 前，不删除、不重命名 `doc/UI源码/`。

- [x] **Step 4: 锁定迁移顺序**
  - 顺序固定为：底座 -> 样式与壳子 -> 静态页面 -> 发票工作台 -> 数据层 -> 异步链路 -> 真实数据接线 -> 验证部署。

- [x] **Step 5: 锁定资源命名**
  - Cloudflare 资源统一使用 `bescuit-operation-assistant-*` 前缀，避免和旧文档中的 `bar-ops-*` 混用。

### Phase 1: 建立 TanStack Start + Cloudflare 底座

**对应原计划：** Task 1  
**依赖：** Phase 0  
**完成标准：**
- 根目录已有 TanStack Start 基础文件
- `wrangler.jsonc`、`src/server.ts`、`vite.config.ts` 可联动
- `pnpm build`、`pnpm cf-typegen` 可运行

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `wrangler.jsonc`
- Create: `drizzle.config.ts`
- Create: `src/routes/__root.tsx`
- Create: `src/server.ts`
- Create: `src/lib/env.ts`
- Reference: `doc/UI源码/package.json`
- Reference: `doc/UI源码/app/layout.tsx`

- [x] **Step 1: 在临时目录生成脚手架**

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
mkdir -p .tmp
cd .tmp
npx @tanstack/cli@latest create bescuit-operation-assistant-app
```

Expected: `.tmp/bescuit-operation-assistant-app/` 生成 React + Start + file-based routing 工程。

- [x] **Step 2: 挑出需要合并回根目录的基础文件**
  - 只合并 `package.json`、`tsconfig.json`、`vite.config.ts`、`src/`、`public/`、基础配置文件。
  - 不覆盖现有 `doc/` 和 `.git/`。

- [x] **Step 3: 安装 Cloudflare 与数据层依赖**

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
pnpm add @tanstack/react-query @tanstack/react-form @tanstack/react-table drizzle-orm
pnpm add -D @cloudflare/vite-plugin wrangler drizzle-kit
```

Expected: `package.json` 中具备 TanStack 数据层与 Cloudflare 部署依赖。

- [x] **Step 4: 配置 `vite.config.ts` 为 Cloudflare SSR 入口**
  - 使用 `@cloudflare/vite-plugin`
  - 保留 TanStack Start 官方 Vite 插件
  - 明确 `ssr` 环境

- [x] **Step 5: 配置 `package.json` scripts**
  - 至少包含 `dev`、`build`、`preview`、`deploy`、`cf-typegen`。

- [x] **Step 6: 建立 `wrangler.jsonc` 基础骨架**
  - `name` 设为 `bescuit-operation-assistant`
  - `main` 指向 `./src/server.ts`
  - 预留 `D1`、`R2`、`Queues`、`AI` binding 位置

- [x] **Step 7: 建立 `src/server.ts` Worker 入口**
  - 先只接通 `fetch`
  - `queue` handler 可以先保留空骨架，但文件路径必须固定下来

- [x] **Step 8: 生成 Cloudflare 类型并确认底座可用**

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
pnpm cf-typegen
pnpm build
```

Expected: 不出现 `missing entry`、`wrangler config invalid`、`route tree missing` 这类底座级错误。

### Phase 2: 搬运设计系统、样式和应用外壳

**对应原计划：** Task 2  
**依赖：** Phase 1  
**完成标准：**
- `src/styles/globals.css` 成为唯一全局样式入口
- `app-shell`、`app-sidebar`、`components/ui/*` 已迁入新工程
- Root Route 能正常注入样式并渲染页面

**Files:**
- Create: `src/components/app-shell.tsx`
- Create: `src/components/app-sidebar.tsx`
- Create: `src/components/metric-card.tsx`
- Create: `src/components/ui/*`
- Create: `src/hooks/use-mobile.ts`
- Create: `src/hooks/use-toast.ts`
- Create: `src/lib/utils.ts`
- Create: `src/styles/globals.css`
- Modify: `src/routes/__root.tsx`
- Create: `public/*`
- Reference: `doc/UI源码/components/**/*`
- Reference: `doc/UI源码/hooks/*`
- Reference: `doc/UI源码/app/globals.css`
- Reference: `doc/UI源码/styles/globals.css`

- [x] **Step 1: 复制 shadcn/radix 组件**
  - 优先复制 `doc/UI源码/components/ui/*`
  - 保持组件名不变，减少后续页面迁移的改动量

- [x] **Step 2: 复制应用壳子与基础展示组件**
  - 复制 `app-shell.tsx`、`app-sidebar.tsx`、`metric-card.tsx`
  - 暂不复制 `theme-provider.tsx`，除非新工程确认仍需要

- [x] **Step 3: 复制基础工具与静态资源**
  - 复制 `doc/UI源码/lib/utils.ts`
  - 复制 `doc/UI源码/public/*`

- [x] **Step 4: 合并重复 hooks**
  - 只保留 `src/hooks/use-mobile.ts`
  - 只保留 `src/hooks/use-toast.ts`
  - 明确删除 `src/components/ui/use-mobile.tsx`、`src/components/ui/use-toast.ts`

- [x] **Step 5: 合并全局样式**
  - 对比 `doc/UI源码/app/globals.css` 与 `doc/UI源码/styles/globals.css`
  - 只保留一份 `src/styles/globals.css`

- [x] **Step 6: 重写 `src/routes/__root.tsx`**
  - 移除 `next/font/google`
  - 移除 `Metadata`
  - 移除 `@vercel/analytics/next`
  - 保留 `<html lang="zh-CN">`、`HeadContent`、`Scripts`

- [x] **Step 7: 验证样式与壳子接通**

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
pnpm build
```

Expected: Root Route 能正确加载 `globals.css`，构建时不再报 Next 专属依赖缺失。

### Phase 3: 建立静态路由骨架并迁移基础页面

**对应原计划：** Task 3  
**依赖：** Phase 2  
**完成标准：**
- `/`、`/sales/new`、`/analytics/monthly`、`/analytics/calendar`、`/calendar` 路由可打开
- sidebar 不再依赖 `next/link` 和 `usePathname`
- `/settings` 死链接被移除或明确替换

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

- [x] **Step 1: 迁移首页到 `src/routes/index.tsx`**
  - 先保留视觉布局和双卡入口
  - 状态区先使用静态占位，不提前接 D1

- [x] **Step 2: 迁移营业额录入页到 `src/routes/sales/new.tsx`**
  - 先保留原型里的字段与布局
  - `useState` 暂时允许存在，等 Phase 7 再切 TanStack Form

- [x] **Step 3: 迁移月分析页到 `src/routes/analytics/monthly.tsx`**
  - 只迁视觉层和 mock 卡片
  - 不在本阶段接 SQL 聚合

- [x] **Step 4: 迁移日历页到 `src/routes/analytics/calendar.tsx`**
  - 先保留当前交互外观
  - 随机数据逻辑保留到 Phase 7 再清理
  - 注：当前实现已改为“确定性 mock 数据”以避免 SSR hydration mismatch，不再使用随机数。

- [x] **Step 5: 新建 `src/routes/calendar.tsx` 兼容旧 URL**
  - 只做 redirect，不承载业务 UI

- [x] **Step 6: 改写 sidebar 导航**
  - 所有 `next/link` 改为 TanStack `Link`
  - 所有 `usePathname()` 改为 `useLocation()` 或 router state
  - 去掉 `/settings` 死链接

- [ ] **Step 7: 手动验证基础页面导航**
  - 首页 -> 营业额页 -> 月分析页 -> 日历页跳转可达
  - 刷新页面不出现 Next App Router 残留错误

### Phase 4: 拆分发票 intake 与 review 工作台

**对应原计划：** Task 4  
**依赖：** Phase 3  
**完成标准：**
- 上传入口与 review 工作台拆成两个路由
- `doc/UI源码/app/invoices/review/page.tsx` 的职责已拆开
- 发票页面不再是单个巨型文件

**Files:**
- Create: `src/routes/invoices/new.tsx`
- Create: `src/routes/invoices/review/$jobId.tsx`
- Create: `src/features/invoices/review-header-form.tsx`
- Create: `src/features/invoices/review-table.tsx`
- Create: `src/features/invoices/document-preview.tsx`
- Reference: `doc/UI源码/app/invoices/review/page.tsx`

- [x] **Step 1: 分解旧页面职责**
  - 把旧页面拆成上传入口、文档预览、头部字段编辑、行项目表格四部分

- [x] **Step 2: 建立 `src/routes/invoices/new.tsx`**
  - 页面只负责选择文件、上传文件、创建 intake job
  - 不在此页承载 review 表格和复杂编辑状态

- [x] **Step 3: 建立 `src/routes/invoices/review/$jobId.tsx`**
  - 页面只负责展示指定 `jobId` 的 review workbench
  - URL 语义从“通用页面”改为“具体任务实例”

- [x] **Step 4: 抽出文档预览组件**
  - 把左栏文件预览、缩放、翻页拆到 `document-preview.tsx`

- [x] **Step 5: 抽出头部表单组件**
  - 发票日期、供应商、总额、税额等字段归到 `review-header-form.tsx`

- [x] **Step 6: 抽出行项目表格组件**
  - 供应商行项目、原料映射、数量价格编辑归到 `review-table.tsx`

- [x] **Step 7: 保持当前页面只做静态或本地状态版本**
  - 本 phase 不强行接 D1 / Queue / Workers AI
  - 目标是先把 UI 结构和文件边界稳定下来
  - 当前实现使用本地 mock store 驱动 intake job 与 review workbench，上传文件不会触发真实 OCR / 自动映射。

### Phase 5: 建立 D1 schema 与 server query/mutation 边界

**对应原计划：** Task 5  
**依赖：** Phase 4  
**完成标准：**
- 最小数据库表结构与 migration 建立完成
- `src/lib/server/queries/*` 与 `src/lib/server/mutations/*` 文件边界清晰
- route 文件不直接写 SQL

**Files:**
- Create: `migrations/0001_initial.sql`
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/server/queries/dashboard.ts`
- Create: `src/lib/server/queries/sales.ts`
- Create: `src/lib/server/queries/invoices.ts`
- Create: `src/lib/server/queries/analytics.ts`
- Create: `src/lib/server/mutations/sales.ts`
- Create: `src/lib/server/mutations/invoices.ts`
- Reference: `doc/05_Web_App_开发计划_Cloudflare_TanStack.md`

- [ ] **Step 1: 锁定第一批最小表**
  - `sales_daily`
  - `source_documents`
  - `intake_jobs`
  - `extraction_results`
  - `invoices`
  - `invoice_items`
  - `ledger_entries`
  - `ingredients`
  - `ingredient_aliases`

- [ ] **Step 2: 建立第一版 migration**
  - 优先保证建表可执行
  - 不提前加入可选优化字段和二期表

- [ ] **Step 3: 建立 D1 client 与 schema 入口**
  - `schema.ts` 只定义表结构
  - `client.ts` 只负责创建数据库访问入口

- [ ] **Step 4: 建立 dashboard / sales / invoices / analytics 查询层**
  - 首页 summary 归 `dashboard.ts`
  - 营业额数据归 `sales.ts`
  - 发票与 intake job 查询归 `invoices.ts`
  - 月分析与日历聚合归 `analytics.ts`

- [ ] **Step 5: 建立写操作边界**
  - `sales.ts` mutation 负责营业额录入
  - `invoices.ts` mutation 负责发票确认、修正与入账

- [ ] **Step 6: 回查 route 文件职责**
  - route 只保留 loader、action、组件组合
  - route 中不再直接维护 mock 数组作为数据源

### Phase 6: 接入 R2 / Queue / Workers AI 异步链路

**对应原计划：** Task 6  
**依赖：** Phase 5  
**完成标准：**
- 上传文件可进入 `source_documents`
- intake job 可进入 Queue
- Worker queue handler 具备最小消费骨架

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `src/server.ts`
- Create: `src/lib/server/bindings.ts`
- Create: `src/lib/server/upload.ts`
- Create: `src/lib/server/queue.ts`
- Create: `src/lib/server/extraction.ts`

- [ ] **Step 1: 在 `wrangler.jsonc` 中补全 bindings**
  - `DB`
  - `RAW_DOCUMENTS`
  - `INTAKE_QUEUE`
  - `AI`

- [ ] **Step 2: 建立 `bindings.ts`**
  - 统一声明运行时会使用到的 Cloudflare bindings
  - 避免每个 server 文件重复写类型

- [ ] **Step 3: 建立 `upload.ts`**
  - 文件上传顺序固定为：写 R2 -> 记 `source_documents` -> 记 `intake_jobs` -> 发 Queue

- [ ] **Step 4: 建立 `queue.ts`**
  - 统一封装 enqueue 逻辑
  - 让 route 和 mutation 不直接拼 queue payload

- [ ] **Step 5: 建立 `extraction.ts`**
  - 把“文档规范化”“结构化字段抽取”从 route 层移走
  - 不在这里直接完成最终入账

- [ ] **Step 6: 扩展 `src/server.ts` queue handler**
  - 遍历 batch messages
  - 调用 extraction 流程
  - 更新 intake job 状态

- [ ] **Step 7: 验证链路顺序**
  - 不允许跳过 `source_documents`
  - 不允许上传后直接伪造 review 数据进入页面

### Phase 7: 把页面从本地 mock 切到真实 loader / Query / Form

**对应原计划：** Task 7  
**依赖：** Phase 6  
**完成标准：**
- 首页、营业额录入、发票 review、分析页、日历页均改接真实数据
- route 中的 mock 常量和随机生成逻辑被删除

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/sales/new.tsx`
- Modify: `src/routes/invoices/new.tsx`
- Modify: `src/routes/invoices/review/$jobId.tsx`
- Modify: `src/routes/analytics/monthly.tsx`
- Modify: `src/routes/analytics/calendar.tsx`

- [ ] **Step 1: 首页改成 loader + Query 混合模式**
  - 首屏摘要走 loader
  - 提交后需要刷新的数据走 Query 失效

- [ ] **Step 2: `sales/new` 改成 TanStack Form**
  - 字段至少包含 `businessDate`、`bbva`、`caixa`、`efectivo`、`notes`
  - 提交成功后回写首页 summary

- [ ] **Step 3: `invoices/new` 改成真实上传页**
  - 上传成功后拿到 `jobId`
  - 自动跳转到 `/invoices/review/$jobId`

- [ ] **Step 4: `invoices/review/$jobId` 改成 Query + Form + Table**
  - header 字段编辑走 Form
  - line items 展示与编辑走 Table
  - 保存 / 确认走 mutation

- [ ] **Step 5: 分析页改接真实聚合**
  - 月收入结构
  - 月支出结构
  - 周趋势

- [ ] **Step 6: 日历页改接真实聚合**
  - 删除 `Math.random()`
  - 删除仅用于演示的假数据生成函数

- [ ] **Step 7: 清理 mock 常量**
  - 删除 `incomeData`
  - 删除 `expenseData`
  - 删除 `weeklyData`
  - 删除 `mockLineItems`
  - 删除 `generateMockData`

### Phase 8: 验证、部署、切换与原型归档

**对应原计划：** Task 8  
**依赖：** Phase 7  
**完成标准：**
- 构建、类型生成、最小 smoke test 通过
- Cloudflare 资源创建并填回配置
- 原型目录进入只读参考状态

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `wrangler.jsonc`
- Reference: `doc/UI源码/`

- [ ] **Step 1: 跑构建与类型生成**

```bash
cd "/Users/zhuyuxia/Documents/GitHub/Bescuit-Operation-Assistant"
pnpm build
pnpm cf-typegen
```

Expected: 构建通过，bindings 类型生成成功。

- [ ] **Step 2: 创建 Cloudflare 资源**

```bash
pnpm wrangler d1 create bescuit-operation-assistant-db
pnpm wrangler r2 bucket create bescuit-operation-assistant-raw-documents
pnpm wrangler queues create bescuit-operation-assistant-intake
pnpm wrangler queues create bescuit-operation-assistant-intake-dlq
```

Expected: 获得真实 `database_id` 和资源名，并回填 `wrangler.jsonc`。

- [ ] **Step 3: 做 4 条最小 smoke test**
  - 首页能展示 summary
  - 营业额录入后首页状态能刷新
  - 上传票据后能创建 intake job 并进入 review 页
  - 月分析和日历页不再显示随机数据

- [ ] **Step 4: 补充仓库文档**
  - `README.md` 写清本地开发、构建、部署和 Cloudflare 资源依赖

- [ ] **Step 5: 处理 `doc/UI源码` 的最终状态**
  - 如果仍需参考，则保留原目录
  - 如果迁移已完全稳定，可追加归档说明，但不要直接删除

## 4. Phase 执行顺序建议

1. 先做 Phase 1 和 Phase 2，把底座与视觉资产打通。
2. 再做 Phase 3 和 Phase 4，把“能看”“能走通 UI 流程”的页面骨架稳定下来。
3. 然后做 Phase 5 和 Phase 6，把真实数据层和异步链路接上。
4. 最后做 Phase 7 和 Phase 8，用真实数据替换 mock，并完成部署切换。

## 5. 关键风险与控制点

- 风险 1：直接在仓库根目录跑脚手架，覆盖现有文档目录。
  - 控制：必须先在 `.tmp/` 生成，再手工合并。

- 风险 2：把发票上传、review、入账继续塞在一个页面里。
  - 控制：强制拆分 `invoices/new` 与 `invoices/review/$jobId`。

- 风险 3：在 route 文件里继续保留 mock 数据，导致迁移完成后仍是假系统。
  - 控制：Phase 7 必须有显式 mock 清理步骤。

- 风险 4：Cloudflare 资源命名继续混用旧前缀。
  - 控制：统一采用 `bescuit-operation-assistant-*`。

- 风险 5：原型目录过早删除，导致迁移时无法回看视觉和交互细节。
  - 控制：直到 Phase 8 完成前，`doc/UI源码` 只读保留。

## 6. 与原计划的关系

- 原文件 [06_UI源码迁移到TanStack_Cloudflare实施计划](./06_UI源码迁移到TanStack_Cloudflare实施计划.md)
  - 适合作为总览版、架构说明版。

- 本文件
  - 适合作为执行版、phase 版、任务推进版。
