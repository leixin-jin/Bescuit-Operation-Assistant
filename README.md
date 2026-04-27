# Bescuit-Operation-Assistant
酒吧业务助手

## 本地开发

```bash
pnpm install
pnpm dev
```

默认开发地址是 `http://localhost:3000`。本地 UI 会使用浏览器存储里的 fallback 数据；如果 Cloudflare bindings 不完整，票据 intake 会退回到本地 fallback 流程。

## 构建、类型与测试

```bash
pnpm build
pnpm cf-typegen
pnpm test
pnpm smoke
```

- `pnpm build` 生成 TanStack Start/Vite 的 client 与 SSR 产物。
- `pnpm cf-typegen` 根据 `wrangler.jsonc` 生成 `src/lib/env.d.ts`。
- `pnpm smoke` 覆盖 Phase 8 的最小页面流：首页/路由、营业额录入边界、票据 intake/review rehydration、月分析和日历页面。

## Cloudflare 资源

`wrangler.jsonc` 依赖以下 Cloudflare bindings：

| Binding | 类型 | 资源名 |
| --- | --- | --- |
| `DB` | D1 | `bescuit-operation-assistant-db` |
| `RAW_DOCUMENTS` | R2 | `bescuit-operation-assistant-raw-documents` |
| `INTAKE_QUEUE` | Queues producer/consumer | `bescuit-operation-assistant-intake` |
| `AI` | Workers AI | account binding |

已创建的资源：

- D1 database: `bescuit-operation-assistant-db`
  - `database_id`: `a0a74b5e-9815-49a7-b7f2-6d0c3d98449f`
- R2 bucket: `bescuit-operation-assistant-raw-documents`
- Queue: `bescuit-operation-assistant-intake`
- Queue DLQ: `bescuit-operation-assistant-intake-dlq`

首次部署前执行远程 D1 schema 初始化：

```bash
pnpm cf:migrate:remote
```

## 部署

```bash
pnpm deploy
```

部署前确认：

- `wrangler.jsonc` 的 D1 `database_id` 是真实 ID。
- R2 已启用并创建 `bescuit-operation-assistant-raw-documents`。
- D1 已执行 `migrations/0001_initial.sql`。
- Queue 与 DLQ 已创建并与 `wrangler.jsonc` 中的名称一致。

## 原型目录

`doc/UI源码/` 是迁移前 Next.js UI 原型，只作为只读视觉和交互参考保留。新功能和修复应在 `src/` 下完成，不再回写原型目录。
