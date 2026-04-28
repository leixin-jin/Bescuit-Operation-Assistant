import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { AlertCircle, ArrowLeft, CheckCircle, Save } from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DocumentPreview } from '@/features/invoices/document-preview'
import { ReviewHeaderForm } from '@/features/invoices/review-header-form'
import { ReviewTable } from '@/features/invoices/review-table'
import type {
  InvoiceHeaderDraft,
  InvoiceLineItemDraft,
  InvoiceReviewJob,
} from '@/lib/server/app-domain'
import {
  getInvoiceJobStage,
  isInvoiceJobProcessing,
} from '@/lib/server/app-domain'
import {
  confirmInvoiceReviewJob,
  saveInvoiceReviewJob,
} from '@/lib/server/mutations/invoices'
import {
  confirmInvoiceReviewJobServerFn,
  saveInvoiceReviewJobServerFn,
} from '@/lib/server/mutations/invoices.rpc'
import {
  formatInvoiceTimestamp,
  getInvoiceReadinessSummary,
  getInvoiceReviewPageData,
  getInvoiceStatusLabel,
} from '@/lib/server/queries/invoices'
import {
  getInvoicePipelineEnabled,
  getInvoiceReviewPageDataServerFn,
} from '@/lib/server/queries/invoices.rpc'
import { getInvoiceDocumentPreviewServerFn } from '@/lib/server/queries/document-preview'

export const Route = createFileRoute('/invoices/review/$jobId')({
  loader: async ({ params }) => {
    const pipelineEnabled = await getInvoicePipelineEnabled()
    const pageData = pipelineEnabled
      ? await getInvoiceReviewPageDataServerFn({
          data: { jobId: params.jobId },
        })
      : await getInvoiceReviewPageData(params.jobId)

    return {
      pipelineEnabled,
      ...pageData,
    }
  },
  component: InvoiceReviewWorkbenchPage,
})

function InvoiceReviewWorkbenchPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { jobId } = Route.useParams()
  const loaderData = Route.useLoaderData()
  const { pipelineEnabled } = loaderData
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  const reviewQuery = useQuery({
    queryKey: ['invoice-review', jobId, pipelineEnabled],
    queryFn: async () => {
      const pageData = pipelineEnabled
        ? await getInvoiceReviewPageDataServerFn({ data: { jobId } })
        : await getInvoiceReviewPageData(jobId)

      return {
        pipelineEnabled,
        ...pageData,
      }
    },
    initialData: loaderData.job?.jobId === jobId ? loaderData : undefined,
    refetchInterval: (query) => {
      const job = query.state.data?.job
      return pipelineEnabled && job && isInvoiceJobProcessing(job) ? 2000 : false
    },
  })
  const pageData = reviewQuery.data ?? loaderData
  const activeJob = pageData.job?.jobId === jobId ? pageData.job : null
  const activeJobStage = activeJob ? getInvoiceJobStage(activeJob) : null
  const documentPreviewQuery = useQuery({
    queryKey: ['invoice-document-preview', jobId, pipelineEnabled],
    queryFn: async () =>
      pipelineEnabled
        ? ((await getInvoiceDocumentPreviewServerFn({ data: { jobId } })) ?? null)
        : null,
    enabled: Boolean(pipelineEnabled && activeJob),
    retry: false,
  })
  const isPipelineJobProcessing = Boolean(
    pipelineEnabled && activeJob && isInvoiceJobProcessing(activeJob),
  )
  const isRehydratingJob = !activeJob && reviewQuery.isFetching

  const form = useForm({
    defaultValues: createInvoiceReviewFormValues(activeJob),
    onSubmitMeta: { mode: 'draft' as ReviewPersistMode },
    onSubmit: async ({ value, meta }) => {
      if (!activeJob || isPipelineJobProcessing) {
        return
      }

      await persistReviewMutation.mutateAsync({ mode: meta.mode, value })
    },
  })
  const persistReviewMutation = useMutation({
    mutationFn: async ({
      mode,
      value,
    }: {
      mode: ReviewPersistMode
      value: InvoiceReviewFormValues
    }) => {
      if (!activeJob) {
        throw new Error('Invoice review job is missing.')
      }

      const reviewJob = mergeReviewFormValues(activeJob, value)

      if (mode === 'draft') {
        const savedJob = pipelineEnabled
          ? await saveInvoiceReviewJobServerFn({ data: { job: reviewJob } })
          : await saveInvoiceReviewJob(reviewJob)

        return {
          mode,
          ok: true,
          job: savedJob,
        }
      }

      const result = pipelineEnabled
        ? await confirmInvoiceReviewJobServerFn({ data: { job: reviewJob } })
        : await confirmInvoiceReviewJob(reviewJob)

      return {
        mode,
        ok: result.ok,
        job: result.job,
      }
    },
    onSuccess: async (result) => {
      form.reset(createInvoiceReviewFormValues(result.job))
      setFeedbackMessage(
        result.mode === 'draft'
          ? '发票草稿已保存。'
          : result.ok
            ? '发票已确认，后续可进入入账链路。'
            : '仍有阻塞项，暂不能确认入账。',
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice-review', jobId] }),
        queryClient.invalidateQueries({ queryKey: ['invoice-jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-analytics'] }),
        router.invalidate(),
      ])
    },
    onError: (error) => {
      setFeedbackMessage(
        error instanceof Error ? error.message : '保存发票 review 失败。',
      )
    },
  })

  useEffect(() => {
    form.reset(createInvoiceReviewFormValues(activeJob))
    setFeedbackMessage(null)
    setZoom(100)
    setRotation(0)
    setCurrentPage(1)
  }, [activeJob, form, jobId])

  const handleHeaderFieldChange = (field: keyof InvoiceHeaderDraft, value: string) => {
    form.setFieldValue(`header.${field}`, value)
  }

  const handleLineItemFieldChange = (
    itemId: string,
    value: string,
    field: 'qty' | 'unitPrice' | 'ingredient',
  ) => {
    const itemIndex = form.state.values.lineItems.findIndex((item) => item.id === itemId)
    if (itemIndex === -1) {
      return
    }

    form.setFieldValue(`lineItems[${itemIndex}].${field}`, value)
    if (field === 'ingredient') {
      form.setFieldValue(`lineItems[${itemIndex}].matched`, Boolean(value.trim()))
    }
  }

  if (isRehydratingJob) {
    return (
      <AppShell>
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center px-6">
          <div className="rounded-xl border bg-background px-6 py-5 text-sm text-muted-foreground">
            正在读取当前浏览器会话中的发票任务...
          </div>
        </div>
      </AppShell>
    )
  }

  if (!activeJob) {
    return (
      <AppShell>
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border bg-background p-6 shadow-sm">
            <p className="text-lg font-semibold">未找到发票任务</p>
            <p className="mt-2 text-sm text-muted-foreground">
              该任务不存在，或者不在当前浏览器会话中。
            </p>
            <Button className="mt-4 rounded-lg" asChild>
              <Link to="/invoices/new">返回 intake</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <form
        className="flex h-[calc(100vh-3.5rem)] flex-col lg:h-screen"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit({ mode: 'confirm' })
        }}
      >
        <form.Subscribe
          selector={(state) => state.values}
          children={(formValues) => {
            const editableJob = mergeReviewFormValues(activeJob, formValues)
            const readinessSummary = getInvoiceReadinessSummary(editableJob)
            const blockingIssueCount =
              readinessSummary.missingHeaderFields.length +
              readinessSummary.invalidHeaderFields.length +
              (readinessSummary.unmatchedLineItems > 0 ? 1 : 0)

            return (
              <>
                <div className="shrink-0 border-b bg-background px-6 py-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <Link
                        to="/invoices/new"
                        className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        返回 intake
                      </Link>
                      <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-xl font-bold">发票 review 工作台</h1>
                        <Badge variant="secondary" className="rounded-lg">
                          {getInvoiceStatusLabel(editableJob.status)}
                        </Badge>
                        <Badge variant="outline" className="rounded-lg">
                          {editableJob.jobId}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {editableJob.fileName} · {formatInvoiceTimestamp(editableJob.uploadedAt)}
                      </p>
                    </div>

                    {editableJob.status === 'error' ? (
                      <Badge
                        variant="secondary"
                        className="gap-1.5 rounded-lg bg-rose-100 text-rose-700"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        抽取失败，等待处理
                      </Badge>
                    ) : isPipelineJobProcessing ? (
                      <Badge
                        variant="secondary"
                        className="gap-1.5 rounded-lg bg-sky-100 text-sky-700"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        {activeJobStage === 'queued' ? 'Queue 排队中' : '异步抽取中'}
                      </Badge>
                    ) : readinessSummary.isReady ? (
                      <Badge
                        variant="secondary"
                        className="gap-1.5 rounded-lg bg-emerald-100 text-emerald-700"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        已满足入账条件
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="gap-1.5 rounded-lg bg-amber-100 text-amber-700"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        {blockingIssueCount} 个入账阻塞项
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
                  <div className="h-[45%] lg:h-full lg:w-[56%]">
                    <DocumentPreview
                      fileName={editableJob.fileName}
                      jobId={editableJob.jobId}
                      uploadedAtLabel={formatInvoiceTimestamp(editableJob.uploadedAt)}
                      currentPage={currentPage}
                      totalPages={editableJob.pageCount}
                      zoom={zoom}
                      rotation={rotation}
                      onZoomIn={() => setZoom((value) => Math.min(200, value + 10))}
                      onZoomOut={() => setZoom((value) => Math.max(50, value - 10))}
                      onRotate={() => setRotation((value) => (value + 90) % 360)}
                      onPreviousPage={() =>
                        setCurrentPage((value) => Math.max(1, value - 1))
                      }
                      onNextPage={() =>
                        setCurrentPage((value) =>
                          Math.min(editableJob.pageCount, value + 1),
                        )
                      }
                      preview={documentPreviewQuery.data ?? null}
                    />
                  </div>

                  <div className="flex h-[55%] flex-col lg:h-full lg:w-[44%]">
                    <div className="flex-1 space-y-6 overflow-auto p-6">
                      <ReviewHeaderForm
                        header={editableJob.header}
                        disabled={isPipelineJobProcessing}
                        onFieldChange={handleHeaderFieldChange}
                      />
                      <ReviewTable
                        lineItems={editableJob.lineItems}
                        ingredientOptions={pageData.ingredientOptions}
                        disabled={isPipelineJobProcessing}
                        onQuantityChange={(itemId, value) => {
                          if (isDecimalInput(value)) {
                            handleLineItemFieldChange(itemId, value, 'qty')
                          }
                        }}
                        onUnitPriceChange={(itemId, value) => {
                          if (isDecimalInput(value)) {
                            handleLineItemFieldChange(itemId, value, 'unitPrice')
                          }
                        }}
                        onIngredientChange={(itemId, value) =>
                          handleLineItemFieldChange(itemId, value, 'ingredient')
                        }
                      />
                    </div>

                    <div className="shrink-0 border-t bg-background px-6 py-4">
                      {feedbackMessage ? (
                        <div className="mb-4 rounded-xl border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
                          {feedbackMessage}
                        </div>
                      ) : null}
                      {isPipelineJobProcessing ? (
                        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-700">
                          <p className="font-medium text-sky-800">正在异步处理文档</p>
                          <p className="mt-2">
                            当前阶段：
                            {activeJobStage === 'queued'
                              ? 'Queue 排队中'
                              : activeJobStage === 'extracting'
                                ? 'OCR / 结构化抽取中'
                                : '处理中'}
                            。页面会自动刷新，抽取完成后再开放编辑。
                          </p>
                        </div>
                      ) : null}
                      {editableJob.status === 'error' ? (
                        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                          <p className="font-medium text-rose-800">异步抽取失败</p>
                          <p className="mt-2">
                            {editableJob.errorMessage?.trim() ||
                              '系统未返回更详细的错误信息。'}
                          </p>
                        </div>
                      ) : null}
                      {readinessSummary.isReady ? null : (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                          <p className="font-medium text-amber-800">
                            入账前还需要补齐以下信息
                          </p>
                          {readinessSummary.missingHeaderFields.length > 0 ? (
                            <p className="mt-2">
                              缺少必填字段：
                              {readinessSummary.missingHeaderFields.join('、')}
                            </p>
                          ) : null}
                          {readinessSummary.invalidHeaderFields.length > 0 ? (
                            <p className="mt-2">
                              金额格式不正确：
                              {readinessSummary.invalidHeaderFields.join('、')}
                            </p>
                          ) : null}
                          {readinessSummary.unmatchedLineItems > 0 ? (
                            <p className="mt-2">
                              还有 {readinessSummary.unmatchedLineItems}{' '}
                              项商品未映射到原料库。
                            </p>
                          ) : null}
                        </div>
                      )}
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          variant="secondary"
                          className="flex-1 rounded-lg"
                          disabled={
                            persistReviewMutation.isPending || isPipelineJobProcessing
                          }
                          onClick={() => void form.handleSubmit({ mode: 'draft' })}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          保存草稿
                        </Button>
                        <Button
                          type="submit"
                          className="flex-1 rounded-lg"
                          disabled={
                            !readinessSummary.isReady ||
                            persistReviewMutation.isPending ||
                            isPipelineJobProcessing
                          }
                        >
                          <CheckCircle className="mr-2 h-4 w-4" />
                          确认入账
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )
          }}
        />
      </form>
    </AppShell>
  )
}

type ReviewPersistMode = 'draft' | 'confirm'

interface InvoiceReviewFormValues {
  header: InvoiceHeaderDraft
  lineItems: InvoiceLineItemDraft[]
}

function createInvoiceReviewFormValues(
  job: InvoiceReviewJob | null,
): InvoiceReviewFormValues {
  return {
    header: job
      ? { ...job.header }
      : {
          supplier: '',
          invoiceNo: '',
          date: '',
          totalAmount: '',
          taxAmount: '',
          notes: '',
        },
    lineItems: job ? job.lineItems.map((item) => ({ ...item })) : [],
  }
}

function mergeReviewFormValues(
  job: InvoiceReviewJob,
  values: InvoiceReviewFormValues,
): InvoiceReviewJob {
  return {
    ...job,
    header: { ...values.header },
    lineItems: values.lineItems.map((item) => ({
      ...item,
      matched: Boolean(item.ingredient.trim()),
    })),
  }
}

function isDecimalInput(value: string) {
  return value === '' || /^\d*\.?\d*$/.test(value)
}
