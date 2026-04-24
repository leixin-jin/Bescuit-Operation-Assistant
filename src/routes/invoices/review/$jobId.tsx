import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { AlertCircle, ArrowLeft, CheckCircle, Save } from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DocumentPreview } from '@/features/invoices/document-preview'
import { ReviewHeaderForm } from '@/features/invoices/review-header-form'
import { ReviewTable } from '@/features/invoices/review-table'
import type { InvoiceHeaderDraft, InvoiceReviewJob } from '@/lib/server/app-domain'
import {
  confirmInvoiceReviewJob,
  saveInvoiceReviewJob,
} from '@/lib/server/mutations/invoices'
import {
  formatInvoiceTimestamp,
  getInvoiceReadinessSummary,
  getInvoiceReviewPageData,
  getInvoiceStatusLabel,
} from '@/lib/server/queries/invoices'

export const Route = createFileRoute('/invoices/review/$jobId')({
  loader: ({ params }) => getInvoiceReviewPageData(params.jobId),
  component: InvoiceReviewWorkbenchPage,
})

function InvoiceReviewWorkbenchPage() {
  const { jobId } = Route.useParams()
  const loaderData = Route.useLoaderData()
  const [job, setJob] = useState<InvoiceReviewJob | null>(loaderData.job)
  const [isRehydratingJob, setIsRehydratingJob] = useState(loaderData.job === null)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    let isCancelled = false

    setJob(loaderData.job)
    setIsRehydratingJob(loaderData.job === null)
    setFeedbackMessage(null)
    setZoom(100)
    setRotation(0)
    setCurrentPage(1)

    void getInvoiceReviewPageData(jobId).then((nextPageData) => {
      if (isCancelled) {
        return
      }

      setJob(nextPageData.job)
      setIsRehydratingJob(false)
    })

    return () => {
      isCancelled = true
    }
  }, [jobId, loaderData.job])

  const activeJob = job?.jobId === jobId ? job : loaderData.job

  const readinessSummary = activeJob
    ? getInvoiceReadinessSummary(activeJob)
    : {
        isReady: false,
        missingHeaderFields: [],
        invalidHeaderFields: [],
        unmatchedLineItems: 0,
      }
  const blockingIssueCount =
    readinessSummary.missingHeaderFields.length +
    readinessSummary.invalidHeaderFields.length +
    (readinessSummary.unmatchedLineItems > 0 ? 1 : 0)

  const updateJob = (updater: (currentJob: InvoiceReviewJob) => InvoiceReviewJob) => {
    setJob((currentJob) => {
      if (!currentJob) {
        return currentJob
      }

      return updater(currentJob)
    })
  }

  const handleHeaderFieldChange = (
    field: keyof InvoiceHeaderDraft,
    value: string,
  ) => {
    updateJob((currentJob) => ({
      ...currentJob,
      header: {
        ...currentJob.header,
        [field]: value,
      },
    }))
  }

  const handleLineItemFieldChange = (
    itemId: string,
    updater: (currentValue: string) => string,
    field: 'qty' | 'unitPrice' | 'ingredient',
  ) => {
    updateJob((currentJob) => ({
      ...currentJob,
      lineItems: currentJob.lineItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]: updater(item[field]),
            }
          : item,
      ),
    }))
  }

  const handleSaveDraft = async () => {
    if (!activeJob) {
      return
    }

    setIsSaving(true)

    try {
      const savedJob = await saveInvoiceReviewJob(activeJob)
      setJob(savedJob)
      setFeedbackMessage('发票草稿已保存。')
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfirm = async () => {
    if (!activeJob) {
      return
    }

    setIsSaving(true)

    try {
      const result = await confirmInvoiceReviewJob(activeJob)
      setJob(result.job)
      setFeedbackMessage(
        result.ok ? '发票已确认，后续可进入入账链路。' : '仍有阻塞项，暂不能确认入账。',
      )
    } finally {
      setIsSaving(false)
    }
  }

  if (isRehydratingJob) {
    return (
      <AppShell>
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center px-6">
          <div className="rounded-xl border bg-background px-6 py-5 text-sm text-muted-foreground">
            正在读取当前浏览器会话中的发票任务…
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
      <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:h-screen">
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
                  {getInvoiceStatusLabel(activeJob.status)}
                </Badge>
                <Badge variant="outline" className="rounded-lg">
                  {activeJob.jobId}
                </Badge>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {activeJob.fileName} · {formatInvoiceTimestamp(activeJob.uploadedAt)}
              </p>
            </div>

            {readinessSummary.isReady ? (
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
              fileName={activeJob.fileName}
              jobId={activeJob.jobId}
              uploadedAtLabel={formatInvoiceTimestamp(activeJob.uploadedAt)}
              currentPage={currentPage}
              totalPages={activeJob.pageCount}
              zoom={zoom}
              rotation={rotation}
              onZoomIn={() => setZoom((value) => Math.min(200, value + 10))}
              onZoomOut={() => setZoom((value) => Math.max(50, value - 10))}
              onRotate={() => setRotation((value) => (value + 90) % 360)}
              onPreviousPage={() => setCurrentPage((value) => Math.max(1, value - 1))}
              onNextPage={() =>
                setCurrentPage((value) => Math.min(activeJob.pageCount, value + 1))
              }
            />
          </div>

          <div className="flex h-[55%] flex-col lg:h-full lg:w-[44%]">
            <div className="flex-1 space-y-6 overflow-auto p-6">
              <ReviewHeaderForm
                header={activeJob.header}
                onFieldChange={handleHeaderFieldChange}
              />
              <ReviewTable
                lineItems={activeJob.lineItems}
                ingredientOptions={loaderData.ingredientOptions}
                onQuantityChange={(itemId, value) => {
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    handleLineItemFieldChange(itemId, () => value, 'qty')
                  }
                }}
                onUnitPriceChange={(itemId, value) => {
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    handleLineItemFieldChange(itemId, () => value, 'unitPrice')
                  }
                }}
                onIngredientChange={(itemId, value) =>
                  handleLineItemFieldChange(itemId, () => value, 'ingredient')
                }
              />
            </div>

            <div className="shrink-0 border-t bg-background px-6 py-4">
              {feedbackMessage ? (
                <div className="mb-4 rounded-xl border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
                  {feedbackMessage}
                </div>
              ) : null}
              {readinessSummary.isReady ? null : (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                  <p className="font-medium text-amber-800">入账前还需要补齐以下信息</p>
                  {readinessSummary.missingHeaderFields.length > 0 ? (
                    <p className="mt-2">
                      缺少必填字段：{readinessSummary.missingHeaderFields.join('、')}
                    </p>
                  ) : null}
                  {readinessSummary.invalidHeaderFields.length > 0 ? (
                    <p className="mt-2">
                      金额格式不正确：{readinessSummary.invalidHeaderFields.join('、')}
                    </p>
                  ) : null}
                  {readinessSummary.unmatchedLineItems > 0 ? (
                    <p className="mt-2">
                      还有 {readinessSummary.unmatchedLineItems} 项商品未映射到原料库。
                    </p>
                  ) : null}
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1 rounded-lg"
                  disabled={isSaving}
                  onClick={() => void handleSaveDraft()}
                >
                  <Save className="mr-2 h-4 w-4" />
                  保存草稿
                </Button>
                <Button
                  className="flex-1 rounded-lg"
                  disabled={!readinessSummary.isReady || isSaving}
                  onClick={() => void handleConfirm()}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  确认入账
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
