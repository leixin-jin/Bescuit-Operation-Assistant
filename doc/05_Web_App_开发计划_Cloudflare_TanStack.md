# 酒吧成本优化 Web App 开发计划（Cloudflare + TanStack）

> 关联文档：
> [[10_Projects/酒吧成本优化计划/01_原材料表总结.md]]
> [[10_Projects/酒吧成本优化计划/02_门店发票回流SOP.md]]
> [[10_Projects/酒吧成本优化计划/03_菜品理论毛利诊断.md]]
> [[10_Projects/酒吧成本优化计划/04_营业额登记与可视化.md]]
> [[10_Projects/酒吧成本优化计划/开发计划.md]]
>
> 版本：v1
>
> 更新日期：2026-04-22

---

## 1. 这次重写计划要解决什么

这次不是继续泛化成一个“大而全财务系统”。

这次要明确做的是：

**一个老板自用的经营录入 + 单据解析 + 成本可视化 + 原料标准化系统。**

它第一阶段主要覆盖 4 件事：

1. 让用户方便录入今日营业额
2. 让用户方便输入一张发票
3. 让系统对外只保留两个入口：`今日营业额` 和 `单张发票`；其中发票入口支持照片、手写、PDF、JSON 等格式，并允许人工修正
4. 让系统围绕重点原料、支出结构、营业额和后续理论毛利，建立可执行的经营视图

一句话：

**这个 Web App 的第一版重点，不是“全面财务自动化”，而是“先把真实经营数据稳定吞进去，并变成能指导动作的图和表”。**

---

## 2. 从现有 4 份业务文档得到的产品边界

### 2.1 这不是员工系统

根据 [[02_门店发票回流SOP.md]]，员工的责任不是录系统，而是：

- 谁拿到单，谁立刻放柜

所以系统的第一版默认是：

- **老板自用**
- **员工不上系统**
- **核心录入发生在老板统一清柜之后**

### 2.2 这不是完整 ERP

根据 [[01_原材料表总结.md]] 和 [[03_菜品理论毛利诊断.md]]，当前更合理的顺序是：

1. 先稳定获取真实单据
2. 先找出前 10 个重点原料
3. 先做标准化与单位换算
4. 再做价格走势与替代采购判断
5. 最后再补 10 道主卖菜的近似理论毛利

所以第一版不应该一开始就做：

- 全菜单利润系统
- 完整库存系统
- 全员移动录单
- 复杂预算与稽核

### 2.3 第一版必须同时覆盖收入与支出

根据 [[04_营业额登记与可视化.md]]，第一版不能只做发票。

它至少还要覆盖：

- 今日营业额录入
- 月度总览
- 日历视图
- 日记账 / 事实表

也就是说，这个 App 第一版要同时回答两类问题：

1. 今天赚了多少钱，钱从哪里来
2. 最近花了多少钱，钱主要花在哪里，哪些原料要重点盯

同时，对外的产品入口也只保留两种：

- `输入今日营业额`
- `输入一张发票`

---

## 3. 已确定的技术路线

这份文档不再保留候选方案，当前技术路线已经固定为：

**方案 B：Cloudflare 为底座，Cloudflare AI 为默认引擎，其他 AI provider 作为补充与 fallback。**

### 3.1 固定技术组合

- TanStack Start
- Cloudflare Workers
- D1
- R2
- Queues
- Workers AI
- AI Gateway
- Gemini / OpenAI 等其他 provider

### 3.2 固定实现方式

- 前端与服务端统一部署在 Cloudflare Workers
- 原始文件统一存放到 R2
- 解析任务统一通过 Queues 异步处理
- 默认先走 Cloudflare AI
- 当文件质量、手写复杂度或置信度不满足要求时，再切其他 provider
- 所有 provider 都通过统一的 extraction adapter 管理

### 3.3 为什么固定用这条路线

原因是：

1. 你的核心问题不是单次 OCR 成功，而是识别后能否稳定入账、更新支出、更新原材料
2. 你的输入格式很多，质量也不稳定，识别能力不能写死
3. Cloudflare 已经能覆盖 Web、存储、队列、数据库和默认 AI 能力
4. 其他 provider 保留为 fallback，能在复杂票据和低质量照片上补强识别成功率

一句话：

**平台统一在 Cloudflare，AI 能力采用“Cloudflare AI 优先，其他 provider 补充”的固定架构。**

---

## 4. Cloudflare AI 在本项目中的定位

可以，而且不只是“能接模型”，而是已经有适合这个 App 的完整拼法。

### 4.1 能直接集成的部分

Cloudflare 当前已经支持：

- 在 TanStack Start 部署到 Workers
- 在服务端通过绑定直接访问 `env.AI`
- 把 PDF、图片、Office、CSV 等文件直接转 Markdown
- 用结构化 JSON 输出约束模型返回
- 用 AI Gateway 接第三方模型

### 4.2 对这个项目最有价值的 Cloudflare AI 用法

#### 用法 1：文档转 Markdown

这一步最适合做你的“单据预处理层”。

它可以先把这些输入转成统一文本语义层：

- PDF
- JPG / JPEG / PNG / WEBP / SVG
- DOCX
- XLSX / XLS
- CSV

对你的意义是：

- 图片、票据、表格、PDF 不用先各写一套解析器
- 系统可以先统一成 Markdown / 文本，再进入第二层业务抽取

#### 用法 2：结构化 JSON 抽取

把 Markdown / 文本喂给模型后，再要求它输出固定 schema 的 JSON。

这一步最适合抽：

- 发票头部字段
- 发票行项目
- 营业额 JSON
- 手写便签里的日期 / 金额 / 供应商 / 类别

#### 用法 3：作为默认提取引擎

对于：

- 清晰照片
- 常见 PDF
- 常见电子票据
- 结构比较简单的表格文件

Cloudflare AI 可以先作为默认引擎。

#### 用法 4：作为第一层筛选，不够再 fallback

对于：

- 很糊的照片
- 倾斜严重的拍照
- 手写比例很高
- 排版很混乱的供应商票据

更合理的做法是：

- 先走 Cloudflare
- 如果低置信度，再切 Gemini / OpenAI

### 4.3 这里必须讲清楚的限制

Cloudflare AI 能直接接入，不代表它会自动替你完成整个“票据到业务入账”的系统。

你仍然必须自己做这 4 层：

1. 上传与原文件存储
2. 提取任务状态机
3. 结构化业务 schema
4. 人工校正与标准化

所以这里的正确理解是：

**Cloudflare AI 能直接集成，并且非常适合做预处理与默认抽取层；但业务正确性仍然要靠你的数据模型、校对队列和人工修正流程。**

---

## 5. 推荐的系统架构

```text
前端（TanStack Start）
    ->
Cloudflare Workers 服务端
    ->
两个业务入口：今日营业额 / 单张发票
    ->
R2 保存原文件
    ->
D1 创建 intake_job / source_document
    ->
Queues 异步触发解析
    ->
Extraction Adapter
    -> Cloudflare AI
    -> Gemini / OpenAI（可选 fallback）
    ->
结构化 JSON
    ->
人工校对工作台
    ->
标准化入库
    ->
ledger / invoices / invoice_items / ingredients / analytics
    ->
月度页 / 日历页 / 成本看板 / 理论毛利基础层
```

---

## 6. 输入入口该怎么设计

### 6.1 总原则

不要按文件格式设计入口。

要按老板每天真实在做的业务动作设计入口。

所以第一版对外只保留 2 个入口：

- `今日营业额`
- `单张发票`

这里要明确区分两层：

- **业务入口**
- **文件格式**

业务入口只有 2 个。
文件格式只是 `单张发票` 入口下面的子方式。

所以正确设计不是：

- 图片入口
- PDF 入口
- JSON 入口

而是：

- 发票入口
  - 可以上传照片
  - 可以上传 PDF
  - 可以导入 JSON
  - 可以直接手填

### 6.2 入口 A：今日营业额

营业额不要走复杂识别。

第一版最稳的做法是：

- 以手动录入为主
- 可选上传结算截图作为附件

字段建议：

- 日期
- BBVA
- CAIXA
- EFECTIVO
- 总营业额
- 备注
- 附件

系统可以支持两种录法：

1. 输入三个渠道金额
2. 输入总额和部分渠道，让系统反推现金

这个入口提交后，系统自动：

- 写入 `sales_daily`
- 生成对应的 `ledger_entries`
- 刷新月度页和日历页

### 6.3 入口 B：单张发票

这个入口是第一版最重要的入口。

这里的关键不是“上传什么格式”，而是：

- **每次处理的是一张发票**
- **一张发票确认后，自动完成支出更新和原材料更新**

`单张发票` 入口内部支持这几种提交方式：

#### A. 照片

适合：

- 纸质发票
- 手写便签
- 送货单

第一版支持：

- 手机拍照上传
- 桌面拖拽上传

手机端默认交互应当是：

- 用户点击手机上的 APP 图标进入系统
- 进入 `单张发票` 页面后，优先看到两个主按钮：
  - `立即拍照`
  - `上传照片`

也就是说，手机端不是先让用户理解文件格式，
而是先让用户完成最自然的动作：

- 当场拍一张
- 或从相册选一张

#### B. PDF

适合：

- 电子 factura
- 邮件转存票据
- 供应商电子单

#### C. JSON

适合：

- Gemini 已经提好的 JSON
- 其他外部自动化流程产出的结构化数据

这一类不要再走 OCR。
应该直接做：

- schema 校验
- 错误提示
- 人工确认

#### D. 手动录入 / 手动修改

这是必须保留的，不是补丁。

因为你最终管理的是财务数据，不是 OCR 演示。

所以系统必须允许：

- 新建发票
- 编辑已解析字段
- 修正行项目
- 修正供应商
- 修正类别
- 修正标准原料映射

### 6.4 单张发票入口提交后的自动动作

当一张发票被确认后，系统自动完成这些事情：

1. 写入 `invoices`
2. 写入 `invoice_items`
3. 自动生成对应的 `ledger_entries` 支出记录
4. 如果行项目已匹配标准原料，自动更新原料采购记录、单位成本和分析结果
5. 如果行项目还没匹配标准原料，先进入待映射队列，但支出记录仍然更新

这一步必须明确：

**输入一张发票，不只是“存一份文件”，而是一次“支出入账 + 原材料采购更新”。**

### 6.5 手机端固定方案：H5 直接拍照 / 上传照片

手机端方案不再保留备选，当前固定为：

**H5 文件选择器方案。**

做法：

- 在 `单张发票` 页面放两个主按钮：
  - `立即拍照`
  - `上传照片`
- `立即拍照` 调用移动端浏览器或系统相机
- `上传照片` 调用相册或文件选择器
- 用户点击手机上的 APP 图标或快捷入口后，直接进入这条流程

为什么固定用 H5：

- 最符合当前 `TanStack Start + Cloudflare` Web App 路线
- 开发成本最低，最适合第一版快速上线
- 已经足够满足“手机点击后直接拍照或上传照片”的核心需求
- 不会把团队过早拖入原生端或复杂摄像头兼容问题

手机端当前范围只保留这一种实现，不再在本文档中展开其他形态。

### 6.6 首页固定布局：双卡首页

首页不再定义成传统“大仪表盘”。

第一版首页固定采用：

**方案 1：双卡首页。**

目标是让老板打开后，在 3 秒内明白系统只让他做两件事：

- `输入今日营业额`
- `输入一张发票`

首页结构固定为 3 层：

1. 顶部轻量标题区
2. 中间两个主卡片
3. 底部轻量状态区

其中：

- 顶部只放产品名、日期和一句提示语
- 中间两个卡片必须是视觉主角
- 底部状态区只放少量结果，不放复杂图表

首页明确不做这些内容：

- 大量 KPI 拼盘
- 多张图表同时出现
- 原料分析明细
- 理论毛利明细
- 复杂筛选器

这些内容应该进入二级页面，例如：

- `/analytics/monthly`
- `/calendar`
- `/ingredients`

首页低保真 wireframe 固定如下：

```text
+-----------------------------------------------------------+
| 酒吧经营助手                           2026-04-22 Tue     |
|                                                           |
| 今天要录什么？                                             |
|                                                           |
| +-------------------------+  +--------------------------+ |
| | 输入今日营业额          |  | 输入一张发票             | |
| | 录入今天收入            |  | 拍照后自动更新支出       | |
| |                         |  | 和原材料                 | |
| |      [开始录入]         |  | [立即拍照] [上传照片]    | |
| +-------------------------+  +--------------------------+ |
|                                                           |
| 今日状态：已录营业额 / 待确认发票 2 / 本月支出概览        |
+-----------------------------------------------------------+
```

这个布局的核心不是“首页展示很多东西”，而是：

**首页只负责清晰分流，复杂分析延后到二级页。**

### 6.7 内页固定布局：左侧功能栏 + 右侧工作区

首页是一个独立的 landing page。

用户一旦从首页进入任意功能，后续页面统一进入：

**左侧功能栏 + 右侧工作区** 的固定 App Shell。

这次页面方案固定为：

- 首页使用双卡首页
- 内页使用左侧功能栏导航
- 右侧工作区根据页面类型再细分内容布局

#### 桌面端固定结构

1. 左侧功能栏
2. 右侧主工作区

左侧功能栏只做一件事：

- **页面级导航**

不要把这些内容塞进左侧功能栏：

- 复杂筛选
- 表单字段
- 分析图表
- 大量操作按钮

这些内容统一放在右侧工作区。

#### 左侧功能栏建议分组

- 录入
  - `今日营业额`
  - `单张发票`
  - `发票校对`
- 经营
  - `月度经营`
  - `日历`
  - `流水`
- 成本
  - `原料`
- 第二阶段再开放
  - `理论毛利`

第一版要保持克制：

- 只显示当前阶段真正可用的页面
- 不要把还没完成的模块提前暴露给用户

#### 右侧工作区的固定规则

虽然内页统一使用左侧功能栏，但右侧工作区不应该所有页面都长得一样。

右侧工作区固定采用两种模板：

#### 模板 A：单列任务流

适用页面：

- `/sales/new`
- `/invoices/new`
- `/analytics/monthly`
- `/analytics/calendar`

特点：

- 从上到下完成任务或阅读结果
- 主按钮固定在底部或页尾
- 信息层级简单
- 最适合手机和日常高频录入

#### 模板 B：左右对照工作台

适用页面：

- `/invoices/review`

必要时可扩展到：

- `/ingredients`

特点：

- 左边看原始内容或参考内容
- 右边做编辑、确认或入账
- 适合需要“对着看、对着改”的页面

也就是说，这次你最终选定的是：

**首页用双卡；内页统一用左侧功能栏；右侧工作区再按 A / B 两种任务模板分流。**

#### 手机端处理方式

手机端不保留永久左侧栏。

手机端做法固定为：

- 左侧功能栏折叠成左上角菜单或抽屉
- 右侧工作区变成单列主内容区
- 发票拍照入口仍然优先显示

所以手机上仍然是简洁产品，不会因为桌面端有侧栏就变复杂。

内页低保真 wireframe 固定如下：

```text
+-----------------------------------------------------------+
| Logo | 页面标题                              [用户/日期]   |
+----------------------+------------------------------------+
| 功能栏               | 右侧工作区                         |
|                      |                                    |
| 录入                 | 根据页面类型切换：                 |
| - 今日营业额         |                                    |
| - 单张发票           | A. 单列任务流                      |
| - 发票校对           | 或                                 |
|                      | B. 左右对照工作台                  |
| 经营                 |                                    |
| - 月度经营           |                                    |
| - 日历               |                                    |
| - 流水               |                                    |
|                      |                                    |
| 成本                 |                                    |
| - 原料               |                                    |
+----------------------+------------------------------------+
```

---

## 7. 解析层应该怎么分

### 7.1 不要一步到位直接“识别成发票”

更稳的分层是：

#### 第一层：Document Normalization

目标：

- 把图片 / PDF / 表格 / 文档转成统一文本表示

输出：

- markdown_text
- raw_blocks
- page_count
- source_metadata

#### 第二层：Business Extraction

目标：

- 从统一文本里抽出业务字段

输出：

- invoice schema
- sales schema
- unknown schema
- confidence

#### 第三层：Review & Correction

目标：

- 把不确定内容交给人修

输出：

- corrected data
- approved data

#### 第四层：Normalization & Posting

目标：

- 把已确认数据落成标准业务对象

输出：

- invoice
- invoice_items
- ledger_entries
- ingredient mappings

### 7.2 为什么这样分

因为你的问题不是单纯 OCR。

你的真正问题是：

- 供应商名不统一
- 商品名不统一
- 规格不统一
- 类别不统一
- 营业额和支出最终要进入同一个经营视图

所以“识别成功”不等于“能入账”。

---

## 8. 关键数据模型

下面不是最终 SQL，而是第一版必须坚持的业务结构。

### 8.1 上传与解析层

#### `source_documents`

保存原始输入对象。

建议字段：

- `id`
- `source_type` (`photo` / `pdf` / `json` / `manual`)
- `document_type_guess` (`invoice` / `sales` / `unknown`)
- `r2_key`
- `original_filename`
- `mime_type`
- `uploaded_at`
- `uploaded_by`
- `status`

#### `intake_jobs`

保存解析任务与状态机。

建议字段：

- `id`
- `source_document_id`
- `extractor_provider`
- `extractor_model`
- `stage` (`queued` / `extracting` / `review` / `approved` / `failed`)
- `confidence_score`
- `error_message`
- `created_at`
- `updated_at`

#### `extraction_results`

保存抽取中间结果。

建议字段：

- `id`
- `intake_job_id`
- `markdown_text`
- `structured_json`
- `raw_response`
- `schema_version`

### 8.2 经营事实层

#### `sales_daily`

保存营业额主记录。

建议字段：

- `id`
- `date`
- `total_amount`
- `bbva_amount`
- `caixa_amount`
- `cash_amount`
- `note`
- `source_document_id`

#### `invoices`

发票主表。

建议字段：

- `id`
- `invoice_date`
- `supplier_id`
- `document_number`
- `subtotal_amount`
- `tax_amount`
- `total_amount`
- `payment_method`
- `currency`
- `source_document_id`
- `review_status`

#### `invoice_items`

发票行项目表。

建议字段：

- `id`
- `invoice_id`
- `raw_product_name`
- `raw_quantity`
- `raw_unit`
- `raw_unit_price`
- `raw_line_total`
- `ingredient_id`
- `normalized_quantity`
- `normalized_unit`
- `normalized_unit_price`
- `mapping_status`

#### `ledger_entries`

唯一事实总账表。

建议字段：

- `id`
- `entry_date`
- `entry_type` (`income` / `expense`)
- `category`
- `amount`
- `account`
- `vendor`
- `source_kind` (`sales` / `invoice`)
- `source_id`

### 8.3 成本优化层

#### `suppliers`

- `id`
- `name`
- `tax_id`
- `default_category`
- `notes`

#### `ingredients`

- `id`
- `name`
- `category`
- `base_unit`
- `is_focus`
- `price_lower_bound`
- `price_upper_bound`
- `notes`

#### `ingredient_aliases`

- `id`
- `ingredient_id`
- `supplier_id`
- `alias_name`
- `spec_text`
- `conversion_rule`

#### `ingredient_substitution_rules`

- `id`
- `ingredient_id`
- `allowed_brand`
- `allowed_spec`
- `quality_floor`
- `action_if_over_price`

### 8.4 理论毛利基础层

#### `dishes`

- `id`
- `name`
- `price`
- `is_focus`
- `serving_note`

#### `recipe_cards`

- `id`
- `dish_id`
- `version`
- `container_spec`
- `notes`

#### `recipe_items`

- `id`
- `recipe_card_id`
- `ingredient_id`
- `quantity`
- `unit`
- `is_variable`

---

## 9. 第一版页面结构

### 9.1 必做页面

页面总结构先固定如下：

- `/` 是独立双卡首页
- 其他内页统一进入左侧功能栏 + 右侧工作区
- 左侧功能栏负责页面切换
- 右侧工作区根据页面类型使用单列任务流或左右对照工作台
- 手机端将左侧功能栏折叠成菜单，不做永久侧栏

#### `/`

双卡首页。

首页只承担入口分流，不承担完整经营分析展示。

固定结构：

- 顶部轻量标题区
- 中间两张主卡：`输入今日营业额` / `输入一张发票`
- 底部轻量状态区：已录营业额、待确认发票、本月支出概览

首页不放：

- 复杂图表
- 多排 KPI
- 原料分析细节
- 理论毛利细节

#### `/sales/new`

今日营业额录入页。

位于统一内页 App Shell 中。

右侧工作区使用：

- **模板 A：单列任务流**

支持：

- 手动录入
- 附件上传
- 修改历史

#### `/invoices/new`

单张发票录入页。

位于统一内页 App Shell 中。

右侧工作区使用：

- **模板 A：单列任务流**

页面顶部优先显示上传与拍照动作。

支持：

- 手机端 H5 点击后直接拍照
- 手机端 H5 从相册上传照片
- 上传一张照片 / PDF / JSON
- 手动补字段
- 查看该张发票解析状态
- 提交确认入账

#### `/invoices/review`

发票人工校对工作台。

这是第一版最关键页面之一。

位于统一内页 App Shell 中。

右侧工作区使用：

- **模板 B：左右对照工作台**

推荐结构：

- 左边：原图 / 原 PDF / 原始票据预览
- 右边：字段编辑、行项目、原料映射、确认入账

支持：

- 原图 / 原 PDF 预览
- AI 抽取字段预览
- 一键修改
- 批准入账
- 退回 draft

#### `/ledger`

事实流水页。

位于统一内页 App Shell 中。

右侧工作区使用：

- 顶部轻量筛选
- 下方单表格或列表

支持：

- 查看所有收入 / 支出记录
- 按日期、类别、来源筛选

#### `/ingredients`

标准原料主表页。

位于统一内页 App Shell 中。

第一版默认保持简单：

- 主表格 / 主列表为主
- 详情通过右侧抽屉或编辑态展开
- 不默认做成复杂三栏页面

支持：

- 标准名称
- 别名
- 单位
- 换算规则
- 价格阈值
- 是否重点原料

#### `/analytics/monthly`

月度经营页。

位于统一内页 App Shell 中。

右侧工作区使用：

- **模板 A：单列任务流**

页面表现应更像“老板月报页”，而不是复杂 BI 工作台。

显示：

- 月收入
- 月支出
- 月净额
- 收入结构图
- 支出结构图

#### `/analytics/calendar`

日历页。

位于统一内页 App Shell 中。

右侧工作区保持简洁：

- 上方日历
- 下方每日摘要或趋势
- 不叠复杂筛选器

显示：

- 每日收入
- 每日支出
- 趋势图

### 9.2 第二阶段页面

#### `/analytics/ingredients`

重点原料分析页。

显示：

- 单位成本走势
- 供应商比价
- 超价提醒
- 替代采购建议

#### `/recipes`

近似配方卡页。

用于：

- 10 道主卖菜
- 第一版理论毛利

---

## 10. 第一版核心交互

### 10.1 单张发票录入流程

```text
在“单张发票”入口上传照片 / PDF / JSON，或直接手填
    ->
系统生成 source_document
    ->
进入 intake_job 队列
    ->
自动解析
    ->
得到结构化结果 + confidence
    ->
高置信度：进入 review 快速确认
低置信度：进入 review 详细修改
    ->
批准入账
    ->
写入 invoices / invoice_items / ledger_entries
    ->
自动更新原料采购记录与成本分析
    ->
如果遇到未识别原料，进入待映射队列
```

### 10.2 今日营业额录入流程

```text
输入日期 + BBVA / CAIXA / EFECTIVO
    ->
系统计算 total
    ->
写入 sales_daily
    ->
同步生成 ledger_entries
    ->
刷新月度页和日历页
```

### 10.3 原料标准化流程

```text
invoice_items 进入系统
    ->
匹配 ingredient_aliases
    ->
匹配成功：自动换算 normalized_unit_price
匹配失败：进入待映射
    ->
老板手动指定标准原料与换算规则
    ->
系统回写 invoice_items
    ->
更新 analytics
```

---

## 11. 识别与校对策略

### 11.1 不要追求“全自动入账”

第一版更合理的目标是：

- **高吞吐**
- **可回看**
- **可修改**
- **不丢单**

而不是：

- 每张票据一次识别完美

### 11.2 建议的置信度分流

#### 高置信度

例如：

- 字段齐全
- 金额校验通过
- 供应商匹配成功
- 行项目结构稳定

处理：

- 快速确认后入账

#### 中置信度

例如：

- 发票头部字段正确
- 但部分行项目不确定

处理：

- 进入 review，人工补几个字段

#### 低置信度

例如：

- 手写太多
- 拍照太糊
- 页面倾斜严重
- 无法识别金额结构

处理：

- 人工完整修正
- 或切换提取引擎重新跑

### 11.3 手写支持应该怎么理解

系统要支持手写，不代表“所有手写都能自动高质量识别”。

更合理的产品承诺是：

- 手写可以上传
- 系统会尝试提取
- 低置信度时进入人工修正
- 修正结果仍然可以进入同一事实层

这才是财务软件该有的稳健性。

---

## 12. 推荐技术栈

### 12.1 前端

- `TanStack Start`
- `React`
- `TanStack Router`
- `TanStack Query`
- `TanStack Table`
- `TanStack Form`
- `Zod`

### 12.2 服务端

- `Cloudflare Workers`
- `Drizzle ORM`
- `D1`
- `R2`
- `Queues`

### 12.3 AI 层

- `Workers AI` 作为默认引擎
- `AI Gateway` 作为统一出口与 fallback 编排
- `Gemini / OpenAI` 作为可插拔 provider

### 12.4 可视化

图表层不用强行追求全 TanStack。

建议：

- 表格和交互用 TanStack
- 图表单独选成熟库

因为你这个项目真正关键的是：

- 录入效率
- review 效率
- 分析正确性

不是图表库是否“同一家”。

---

## 13. 分阶段开发顺序

### Phase 0：业务准备

先做这些，不做系统也必须做：

- [ ] 固定门店发票柜
- [ ] 明确每日清柜时间
- [ ] 确定营业额录入口径
- [ ] 整理前 10 个高支出原料
- [ ] 确定重点原料标准单位
- [ ] 初步补可替代品牌 / 规格
- [ ] 选出 10 道主卖菜

### Phase 1：项目底座

目标：

- 把 Cloudflare + TanStack Start 项目跑起来

包含：

- [ ] 初始化 TanStack Start on Cloudflare
- [ ] 配置 Wrangler
- [ ] 接入 D1 / R2 / Queues / AI binding
- [ ] 建基础 schema
- [ ] 完成登录态策略（如果仍是老板自用，可先做极简）
- [ ] 建立首页与内页共用的基础 App Shell

### Phase 2：输入层

目标：

- 能录今日营业额，也能录一张发票

包含：

- [ ] 营业额录入页
- [ ] 单张发票录入页
- [ ] 内页左侧功能栏导航
- [ ] 手机端 H5 支持“立即拍照”和“上传照片”
- [ ] 发票入口支持照片 / PDF / JSON / 手填
- [ ] JSON 导入校验
- [ ] 原文件存 R2
- [ ] 创建 intake_job

### Phase 3：解析与 review 层

目标：

- 让文件变成可确认的数据

包含：

- [ ] Cloudflare AI 默认提取流程
- [ ] 第三方 provider adapter
- [ ] review 工作台
- [ ] review 页左右对照布局
- [ ] 手动修正
- [ ] 重试 / 切换模型

### Phase 4：经营事实层

目标：

- 稳定写入业务数据

包含：

- [ ] `sales_daily`
- [ ] `invoices`
- [ ] `invoice_items`
- [ ] `ledger_entries`
- [ ] 回溯链路

### Phase 5：标准化与成本层

目标：

- 开始真正支持成本优化

包含：

- [x] `ingredients`
- [x] `ingredient_aliases`
- [ ] 单位换算
- [ ] 重点原料标记
- [ ] 原料比价与走势

### Phase 6：经营报表层

目标：

- 形成第一版老板视图

包含：

- [x] 月度页
- [x] 日历页
- [x] 首页双卡入口 + 轻量状态区
- [x] 左侧功能栏下的统一报表导航体验
- [x] 支出结构
- [x] 收入结构

### Phase 7：理论毛利基础层

目标：

- 只服务 10 道主卖菜

包含：

- [ ] `dishes`
- [ ] `recipe_cards`
- [ ] `recipe_items`
- [ ] 第一版理论毛利

---

## 14. MVP 验收标准

第一版真正上线后，至少要满足这些标准：

### 输入层

- 我打开首页后，能在 3 秒内看懂只有两个主要动作：`输入今日营业额` 和 `输入一张发票`
- 我进入内页后，能通过左侧功能栏快速切换到想要的页面
- 我能在 1 分钟内录入今日营业额
- 我能录入一张发票
- 我能在手机上点击 APP 后直接拍照，或从相册上传照片
- 我能在发票入口上传照片、PDF、JSON，或直接手填
- AI 解析错了以后，我能手动改

### 数据层

- 所有收入和支出最终都能进入统一事实表
- 原始文件和入账记录可以追溯
- 一张发票识别失败不会影响其他已保存记录

### 分析层

- 我能看到本月收入、支出、净额
- 我能看到日历与日趋势
- 我能看到前 10 原料的采购金额与价格变化

### 管理层

- 我能识别哪些发票还没确认
- 我能知道哪些原料最近异常变贵
- 我能开始为 10 道主卖菜准备理论毛利基础数据
- 我能在桌面端左右对照原票据和编辑结果完成发票校对

---

## 15. 当前最重要的设计原则

### 原则 1

**所有分析都不要直接依赖原始商品名。**

必须尽量基于：

- 标准原料
- 标准单位
- 标准单位成本

### 原则 2

**对外只有两个业务入口；发票入口内部再兼容多种格式。**

不要把：

- PDF
- 图片
- JSON
- 手动录入

做成彼此孤立的系统。

要做成：

- `今日营业额` 走收入流水链路
- `单张发票` 走发票解析、支出入账、原材料更新链路

### 原则 3

**AI 只负责提取，不负责最终财务真相。**

最终真相必须由：

- review
- 人工修正
- 标准化规则
- 事实表

共同决定。

### 原则 4

**先把老板每天真的会用的动作做顺。**

优先级始终是：

1. 营业额录入
2. 发票回流
3. 单张发票自动入账
4. review 修正
5. 重点原料分析

而不是先做看起来很高级但每天不用的模块。

### 原则 5

**首页负责分流，不负责承载全部经营分析。**

首页必须优先保证：

- 一眼看懂
- 两步内开始录入
- 手机上也不拥挤

完整分析、趋势和明细，统一放到二级页。

### 原则 6

**首页和内页必须是两种不同角色的布局。**

- 首页负责“开始做什么”
- 内页负责“在当前页面把事情做完”

不要把首页做成内页，也不要把内页做成首页式入口页。

### 原则 7

**左侧功能栏只负责切页，不负责承载复杂操作。**

左侧功能栏应该始终保持：

- 短
- 稳定
- 易懂

复杂操作、录入动作、筛选条件和分析模块，都应该进入右侧工作区。

---

## 16. 一句话结论

这套 Web App 最合理的第一版，不是“Cloudflare 上的全自动财务 AI”。

而是：

**一个运行在 Cloudflare 上、用 TanStack Start 做前端框架、以 Cloudflare AI 为默认文档提取层、允许 Gemini / OpenAI fallback、并把所有收入和票据统一沉淀成经营事实表的老板自用系统。**

---

## 17. 外部技术依据

- TanStack Start 部署到 Cloudflare Workers：
  https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- TanStack Start Hosting / Cloudflare：
  https://tanstack.com/start/latest/docs/framework/react/guide/hosting
- Workers AI Markdown Conversion：
  https://developers.cloudflare.com/workers-ai/features/markdown-conversion/
- Workers AI Supported Formats：
  https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/
- Workers AI Binding Usage：
  https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/
- Workers AI JSON Mode：
  https://developers.cloudflare.com/workers-ai/features/json-mode/
- R2 Event Notifications：
  https://developers.cloudflare.com/r2/buckets/event-notifications/
- AI Gateway Providers：
  https://developers.cloudflare.com/ai-gateway/usage/providers/
