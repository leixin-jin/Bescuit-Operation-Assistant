# 发票校对 AI 抽取与照片/PDF 上传实施计划

检查日期：2026-05-03  
修订日期：2026-05-08

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 0. 目标

现有发票链路已经具备 TanStack Start + Cloudflare Workers、D1、R2、Queue、Workers AI binding，但当前“校对结果不满意”的主要原因不是上传链路，而是抽取层仍停留在：

1. `env.AI.toMarkdown()` 先把 PDF/图片转成 markdown。
2. `extractInvoiceReviewDraft()` 再用正则从 markdown 里猜供应商、发票号、日期、总额、税额、行项目。

本计划目标是移除 `env.AI.toMarkdown()` 这一步，把发票校对切换为“原始文件直传多模态 API 的结构化抽取”，并补齐照片/PDF 上传体验：

- 发票入口支持手机拍照、相册图片、PDF 文件。
- 支持一次选择图片和 PDF，按文件创建 intake job，逐张进入异步抽取。
- 抽取层直接把 R2 原始文件内容传给支持图片/PDF 或多模态输入的 API。
- 默认推荐 Cloudflare AI Gateway 统一接第三方多模态模型；Cloudflare Workers AI 只在模型支持直接视觉输入时作为候选 provider。
- 结构化结果直接产出符合 review 工作台的数据，不再经过 markdown 中间态。

## 1. 当前代码事实

### 1.1 已存在能力

- 上传入口：`src/routes/invoices/new.tsx`
  - 当前只有单文件 input。
  - `accept={INVOICE_UPLOAD_ACCEPT}` 已包含 PDF 和常见图片格式。
  - 提交时只把一个 `File` 放进 `FormData` 的 `file` 字段。
- 文件校验：`src/features/invoices/intake-file-validation.ts`
  - 已允许 `.pdf`、`.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`、`.bmp`、`.tif`、`.tiff`、`.heic`、`.heif`。
  - 单文件上限是 10 MB。
- 服务端上传：`src/lib/server/upload.ts`
  - 每个文件生成一个 `source_documents` 和一个 `intake_jobs`。
  - 原文件写入 `RAW_DOCUMENTS` R2。
  - job 投递到 `INTAKE_QUEUE`。
- 异步抽取：`src/lib/server/extraction.ts`
  - Queue consumer 从 R2 读文件。
  - 有 `AI` binding 时调用 `env.AI.toMarkdown({ name, blob })`。
  - 之后用 `extractInvoiceReviewDraft()` 做启发式结构化。
- 预览：`src/lib/server/queries/document-preview.ts`、`src/features/invoices/document-preview.tsx`
  - 图片用 `<img>` 预览。
  - PDF 用 `<iframe>` 预览。
- Cloudflare 配置：`wrangler.jsonc`
  - 已配置 `DB`、`RAW_DOCUMENTS`、`INTAKE_QUEUE`、`AI`。

### 1.2 主要问题

- 抽取结果质量受限于 markdown 转换和正则，不适合真实西班牙供应商发票、拍照票据、表格错位、税额/折扣/多税率场景。
- 多模态模型应直接看原始照片/PDF，避免先转换成 markdown 时丢失表格位置、行列关系、印章、手写标记和拍照方向等视觉信息。
- 当前 schema 的 `extraction_results.structured_json` 可以存草稿，但没有强 schema 校验、字段置信度和校验错误。
- 页面文案说支持图片，但 UX 仍像“上传一个文件”，没有手机拍照入口、批量选择、混合 PDF/照片队列。
- `extractorProvider` 只在 `upload.ts` 里粗略记录 `workers-ai` 或 `heuristic`，没有实际 provider 策略。

## 2. 需求

### 用户故事

作为门店经营者，我希望拍照或上传 PDF 后，系统能更准确地提取发票头部和明细，以便我只做校对和原料映射，而不是手动重录整张发票。

### 验收标准

1. WHEN 用户在发票 intake 页面选择一张 PDF THEN 系统 SHALL 上传文件到 R2、创建 intake job、进入异步抽取。
2. WHEN 用户在手机上点击拍照上传 THEN 系统 SHALL 调起相机或允许选择相册图片，并按图片文件创建 intake job。
3. WHEN 用户一次选择多张图片或 PDF THEN 系统 SHALL 对每个文件独立校验、独立上传、独立创建 job，并展示每个 job 的创建结果。
4. WHEN 文件是图片或 PDF THEN review 页面 SHALL 展示原文件预览，并保留缩放、旋转、翻页能力。
5. WHEN AI provider 可用 THEN 系统 SHALL 把原始图片/PDF 内容直接传给多模态模型，并输出发票 header、lineItems、置信度和校验提示。
6. WHEN 结构化模型失败 THEN 系统 SHALL 标记 job 为 `error` 或 fallback 到明确配置的备选 provider，不得静默生成误导性草稿。
7. WHEN 模型返回不符合 schema 的 JSON THEN 系统 SHALL 拒绝写入 `needs_review`，记录 raw response 和错误原因。
8. WHEN header 总额与行项目合计明显不一致 THEN 系统 SHALL 在 review 工作台展示阻塞或警告，而不是假定结果正确。
9. WHEN provider 被切换为 Cloudflare Workers AI、Cloudflare AI Gateway 或第三方 API THEN 上传页面和 review 页面 SHALL 不需要改动。

## 3. 架构

### 3.1 推荐方案

采用直接多模态 AI pipeline：

```text
R2 原始文件
  -> 文件输入适配层
     -> 校验 MIME / size / extension
     -> 读取 ArrayBuffer
     -> 转成 provider 需要的 base64 / data URL / multipart body
  -> 多模态结构化抽取层
     -> AI Gateway 第三方多模态模型
     -> 或支持图片/PDF 直接输入的 Cloudflare Workers AI 模型
     -> 输出 InvoiceExtractionDraftV2
  -> 业务校验层
     -> schema 校验、金额校验、字段置信度、review warnings
  -> extraction_results + intake_jobs
  -> review 工作台
```

新流程不再调用 `env.AI.toMarkdown()`，也不再把 markdown 作为结构化抽取的输入。模型必须直接基于原始图片/PDF 生成结构化 JSON。PDF 如果目标 provider 不支持直接输入，允许在文件输入适配层转换为页面图片，但转换结果仍作为视觉输入传给模型，不生成 markdown。

### 3.2 Provider Adapter

新增一个统一接口，隔离具体 AI provider：

```ts
interface InvoiceExtractionProvider {
  id: string
  extract(input: InvoiceExtractionProviderInput): Promise<InvoiceExtractionProviderResult>
}
```

建议 provider：

| Provider | 用途 | 推荐优先级 |
|---|---|---|
| `ai-gateway-openai-vision` | 通过 Cloudflare AI Gateway 调支持图片/PDF 视觉输入的 OpenAI 兼容模型 | P0，质量优先路径 |
| `ai-gateway-google-vision` | 通过 Cloudflare AI Gateway 调 Gemini 类多模态模型 | P0/P1，图片和 PDF 理解候选 |
| `cloudflare-workers-ai-vision-json` | 仅在 Workers AI 模型支持直接图片/PDF 输入和 JSON 输出时启用 | P1，平台统一路径 |
| `heuristic-v1` | 保留现有正则逻辑，只用于本地开发或显式兜底 | P2，不作为生产默认 |

### 3.3 配置策略

新增环境变量或 binding 配置：

- `INVOICE_EXTRACTION_PROVIDER`
  - `ai-gateway-openai-vision`
  - `ai-gateway-google-vision`
  - `cloudflare-workers-ai-vision-json`
  - `heuristic-v1`
- `INVOICE_EXTRACTION_FALLBACK_PROVIDER`
  - 可选，建议生产只允许一个明确 fallback。
- `AI_GATEWAY_BASE_URL`
  - 例如 Cloudflare AI Gateway OpenAI-compatible `/compat` base URL；实际请求使用 `/compat/chat/completions`。
- `AI_GATEWAY_API_TOKEN`
  - 使用 Wrangler secret，不写入仓库。
- `INVOICE_EXTRACTION_MODEL`
  - provider 对应模型名。
- `INVOICE_PDF_INPUT_MODE`
  - `native-pdf`：provider 原生支持 PDF 输入时使用。
  - `page-images`：provider 不支持 PDF 时，把 PDF 渲染为页面图片后提交给视觉模型。

`wrangler.jsonc` 不应硬编码第三方 API key。密钥使用 `wrangler secret put`。

## 4. 数据模型

### 4.1 新结构化草稿版本

保留当前 `InvoiceExtractionDraft` 的兼容字段，新增 V2 字段：

```ts
interface InvoiceExtractionDraftV2 {
  schemaVersion: 'invoice-extraction-v2'
  pageCount: number
  documentKind: 'pdf' | 'image' | 'mixed' | 'unknown'
  header: {
    supplier: string
    invoiceNo: string
    date: string
    subtotalAmount: string
    taxAmount: string
    totalAmount: string
    currency: 'EUR' | string
    notes: string
  }
  lineItems: Array<{
    id: string
    name: string
    qty: string
    unit: string
    unitPrice: string
    lineTotal: string
    taxRate?: string
    ingredient: string
    matched: boolean
    confidence?: number
    sourceText?: string
  }>
  confidence: {
    overall: number
    header: number
    lineItems: number
    totals: number
  }
  warnings: string[]
  extractedText?: string
  sourcePages?: Array<{
    pageNumber: number
    kind: 'image' | 'pdf-page'
    width?: number
    height?: number
  }>
  provider: string
  model: string
}
```

### 4.2 数据库存储

第一阶段不必新增表，先复用：

- `extraction_results.structured_json`
- `extraction_results.markdown_text`
- `extraction_results.raw_response`
- `extraction_results.schema_version`
- `intake_jobs.extractor_provider`
- `intake_jobs.extractor_model`
- `intake_jobs.confidence_score`
- `intake_jobs.error_message`

建议把 `schema_version` 从 `invoice-extraction-v1` 升级为 `invoice-extraction-v2`。`markdown_text` 字段在新流程中只作为兼容字段保留，可以写入空字符串或 provider 返回的 `extractedText`，但不得再作为模型输入来源。如果后续需要审计，可再新增 `extraction_attempts` 表记录每次 provider 尝试。

## 5. 详细任务计划

### Phase 1: 抽取 schema 与 provider 边界

**目标：** 先定义直接视觉抽取的输入/输出接口，保证后续替换 provider 不影响 Queue、上传、review 页面。

**Files:**

- Modify: `src/lib/server/extraction.ts`
- Create: `src/lib/server/invoice-extraction/schema.ts`
- Create: `src/lib/server/invoice-extraction/providers.ts`
- Create: `src/lib/server/invoice-extraction/file-input.ts`
- Create: `src/lib/server/invoice-extraction/heuristic-provider.ts`
- Modify: `src/tests/invoice-extraction.test.ts`

- [ ] 1. 定义 `InvoiceExtractionDraftV2`、JSON Schema、parse/normalize 函数。
- [ ] 2. 定义 `InvoiceExtractionProviderInput`，包含 `fileName`、`mimeType`、`arrayBuffer`、`dataUrl/base64`、`documentKind`，不包含 markdown 字段。
- [ ] 3. 把现有 `extractInvoiceReviewDraft()` 移入 `heuristic-provider.ts`，并标记为 dev-only fallback。
- [ ] 4. 保留 `parseStoredExtractionDraft()` 对 v1/v2 的兼容。
- [ ] 5. 新增 schema 校验失败测试、v1 rehydration 测试、v2 confidence/warnings 测试。

### Phase 2: 移除 Markdown Conversion 并建立文件输入适配层

**目标：** 从 Queue 流程中删除 `env.AI.toMarkdown()` 调用，改为直接把 R2 原始文件转换成 provider 可接受的视觉输入。

**Files:**

- Create: `src/lib/server/invoice-extraction/file-input.ts`
- Modify: `src/lib/server/bindings.ts`
- Modify: `src/lib/server/extraction.ts`
- Modify: `src/tests/invoice-extraction.test.ts`
- Modify: `src/tests/queue-consumer-fallback.test.ts`

- [ ] 1. 删除 `normalizeInvoiceDocument()` 中对 `env.AI.toMarkdown()` 的调用路径。
- [ ] 2. 新增 `buildInvoiceProviderInput()`：从 R2 object 读取 `ArrayBuffer`，保留 `mimeType`、`fileName`、`size`。
- [ ] 3. 图片文件生成 data URL 或 base64 content block。
- [ ] 4. PDF 文件按 `INVOICE_PDF_INPUT_MODE` 处理：优先 native PDF 输入；provider 不支持时进入 page-images 转换任务。
- [ ] 5. `extraction_results.markdown_text` 在新流程中写空字符串或 `extractedText`，但不参与抽取。
- [ ] 6. 增加测试确认 Queue consumer 不再调用 `AI.toMarkdown`。

### Phase 3: 接入 Cloudflare AI Gateway / 第三方多模态 API

**目标：** 让质量更好的多模态模型直接分析照片/PDF，并把 provider 切换变成配置。

**Files:**

- Create: `src/lib/server/invoice-extraction/ai-gateway-provider.ts`
- Modify: `src/lib/server/bindings.ts`
- Modify: `wrangler.jsonc`
- Update: `README.md`
- Create/Modify tests under `src/tests/`

- [ ] 1. 新增 `AI_GATEWAY_BASE_URL`、`AI_GATEWAY_API_TOKEN`、`INVOICE_EXTRACTION_PROVIDER`、`INVOICE_EXTRACTION_MODEL` 绑定类型。
- [ ] 2. 使用 OpenAI-compatible chat/completions 或 responses 风格封装视觉输入请求，content 中包含图片/PDF 文件内容。
- [ ] 3. 支持 provider/model 组合，例如 `openai/...`、`google/...`、`anthropic/...`、`workers-ai/...`，但只允许声明支持视觉输入的模型进入生产配置。
- [ ] 4. 对第三方 API 超时、429、5xx、schema 错误做统一错误类型。
- [ ] 5. raw response 存入 `extraction_results.raw_response`，但不得存储 API key 或 Authorization header。
- [ ] 6. 增加 provider selection 测试，确认页面和 Queue 不关心底层 provider。

### Phase 4: 可选接入 Cloudflare Workers AI 视觉模型

**目标：** 如果 Workers AI 可用模型支持直接视觉输入和 JSON 输出，则作为平台统一或 fallback provider；如果不支持，则不为了使用 Workers AI 恢复 markdown 中间层。

**Files:**

- Create: `src/lib/server/invoice-extraction/workers-ai-vision-provider.ts`
- Modify: `src/lib/server/bindings.ts`
- Modify: `src/lib/server/extraction.ts`
- Modify: `src/lib/env.d.ts` via `pnpm cf-typegen`

- [ ] 1. 新增 `cloudflare-workers-ai-vision-json` provider。
- [ ] 2. 使用 `env.AI.run(model, input)` 直接提交图片/PDF 可接受的内容。
- [ ] 3. Prompt 固定要求：只返回 JSON；金额使用点号小数；日期使用 `YYYY-MM-DD`；不确定字段留空并写入 warnings。
- [ ] 4. 如果选定 Workers AI 模型不支持目标文件类型，直接返回配置错误，不 fallback 到 markdown。
- [ ] 5. 对 JSON Mode 失败、非 JSON、schema 不匹配分别记录错误。

### Phase 5: 重写 Queue 抽取流程

**目标：** Queue consumer 从“toMarkdown + heuristic”升级为“file input + provider extract + validate + persist”。

**Files:**

- Modify: `src/lib/server/extraction.ts`
- Modify: `src/lib/server/upload.ts`
- Modify: `src/tests/invoice-extraction.test.ts`
- Modify: `src/tests/queue-consumer-fallback.test.ts`

- [ ] 1. `processInvoiceIntakeQueueMessage()` 调用 provider registry。
- [ ] 2. `intake_jobs.extractor_provider` 和 `extractor_model` 写入真实 provider/model。
- [ ] 3. `confidence_score` 使用 provider 返回的 `confidence.overall`。
- [ ] 4. 只有 schema 校验通过才进入 `needs_review`。
- [ ] 5. 抽取失败时保留 R2 原文件，job 进入 `error`，review 页面展示错误原因。
- [ ] 6. 删除或废弃 `DocumentNormalizationResult`、`normalizeInvoiceDocument()` 这类 markdown normalization 概念。

### Phase 6: 照片/PDF 上传体验

**目标：** 从“单文件上传框”升级为“拍照/选文件/混合队列”。

**Files:**

- Modify: `src/routes/invoices/new.tsx`
- Modify: `src/features/invoices/intake-file-validation.ts`
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
- Modify: `src/lib/server/upload.ts`
- Add/Modify tests under `src/tests/`

- [ ] 1. 前端 input 支持 `multiple`，保留 `accept={INVOICE_UPLOAD_ACCEPT}`。
- [ ] 2. 增加移动端拍照 input：`accept="image/*"`，可使用 `capture="environment"`。
- [ ] 3. UI 显示待上传文件列表：文件名、大小、类型、校验状态、创建结果。
- [ ] 4. 提交时逐个文件上传；一个文件失败不阻塞其他文件。
- [ ] 5. 服务端新增批量 server fn，或前端并发调用现有单文件 server fn；推荐先前端逐个调用，降低后端改动。
- [ ] 6. 每个文件仍创建独立 `source_documents` 和 `intake_jobs`，保持当前 schema 不变。
- [ ] 7. 文案从“选择发票文件”改为“拍照或上传 PDF/图片”。
- [ ] 8. 增加测试：图片+PDF 混合选择、部分失败、超大图片拒绝、空文件拒绝。

### Phase 7: Review 工作台呈现质量信号

**目标：** 让用户知道哪些字段可信、哪些字段必须改，而不是只看到一个草稿。

**Files:**

- Modify: `src/routes/invoices/review/$jobId.tsx`
- Modify: `src/features/invoices/review-header-form.tsx`
- Modify: `src/features/invoices/review-table.tsx`
- Modify: `src/lib/server/app-domain.ts`
- Modify: `src/lib/server/queries/invoices.rpc.ts`

- [ ] 1. 在 review header 显示 provider、model、overall confidence。
- [ ] 2. 在字段旁显示低置信度或缺失提示。
- [ ] 3. 行项目展示 `lineTotal`、`confidence`、`sourceText` 的轻量提示。
- [ ] 4. 金额校验：行项目合计、税额、总额不一致时写入 blocking/warning。
- [ ] 5. 保留人工修正为最终事实，AI 结果只作为草稿。

### Phase 8: 验证与上线

**目标：** 用真实样本验证新 provider 的抽取质量。

**Files:**

- Add: `src/tests/invoice-extraction-provider-contract.test.ts`
- Add: `doc/10_发票AI抽取样本评估记录.md`（可选）
- Update: `README.md`

- [ ] 1. 准备 10-20 张真实供应商发票样本，覆盖 PDF、手机照片、斜拍、模糊、长表格、多税率。
- [ ] 2. 对每个 provider 记录字段准确率：供应商、发票号、日期、总额、税额、明细名称、数量、单价、行总额。
- [ ] 3. 确定生产默认 provider。
- [ ] 4. 运行 `pnpm test`、`pnpm build`、`pnpm cf-typegen`。
- [ ] 5. 部署前确认 secrets 已配置，且生产环境不启用 `heuristic-v1` 作为静默默认。

## 6. Provider 决策建议

### 默认建议

如果目标是“尽快提升校对结果质量”，建议生产默认：

```text
INVOICE_EXTRACTION_PROVIDER=ai-gateway-openai-vision 或 ai-gateway-google-vision
INVOICE_EXTRACTION_FALLBACK_PROVIDER=cloudflare-workers-ai-vision-json
```

原因：

- 发票照片的视觉理解、表格结构恢复、异常格式处理通常需要更强的多模态模型。
- AI Gateway 可以把第三方模型接入统一出口，后续切换 provider 不影响业务代码。
- Workers AI 只在支持直接视觉输入时承担低成本 fallback 或未来默认路径。

如果目标是“成本和平台统一优先”，建议默认：

```text
INVOICE_EXTRACTION_PROVIDER=cloudflare-workers-ai-vision-json
INVOICE_EXTRACTION_FALLBACK_PROVIDER=
```

但必须接受：复杂照片发票的结果可能仍需要更多人工校对。

## 7. Cloudflare 文档依据

- Workers AI binding 支持在 Wrangler 中配置 `ai.binding = "AI"`，并通过 `env.AI.run()` 执行模型：<https://developers.cloudflare.com/workers-ai/configuration/bindings/>
- Workers AI JSON Mode 支持通过 `response_format` 请求结构化 JSON，但文档明确说明不能保证所有复杂 schema 都成功，需要处理失败：<https://developers.cloudflare.com/workers-ai/features/json-mode/>
- Cloudflare AI Gateway 提供 OpenAI-compatible `/compat/chat/completions` 入口，并支持切换 OpenAI、Anthropic、Google、Workers AI 等 provider：<https://developers.cloudflare.com/ai-gateway/get-started/>

## 8. 完成定义

本计划完成时，应满足：

- `/invoices/new` 可以拍照上传，也可以混合选择图片和 PDF。
- 每个上传文件都有独立 job、状态和错误反馈。
- Queue 抽取不再依赖正则作为生产主路径。
- Queue 抽取不再调用 `env.AI.toMarkdown()`，也不再把 markdown 作为 AI 输入。
- `extraction_results.structured_json` 存储 v2 schema，review 页面能稳定 rehydrate。
- 低置信度、金额不一致、字段缺失能在 review 工作台清楚暴露。
- provider 可通过配置切换，不需要改页面代码。
- 生产环境 provider、model、secret 配置写入 README 或部署说明。
