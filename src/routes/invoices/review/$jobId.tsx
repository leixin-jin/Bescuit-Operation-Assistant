import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Save,
} from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DocumentPreview } from '@/features/invoices/document-preview'
import {
  formatInvoiceTimestamp,
  getOrCreateInvoiceJob,
  getStatusLabel,
  ingredientOptions,
  saveInvoiceJob,
  type InvoiceHeaderDraft,
  type InvoiceReviewJob,
} from '@/features/invoices/mock-store'
import { ReviewHeaderForm } from '@/features/invoices/review-header-form'
import { ReviewTable } from '@/features/invoices/review-table'

export const Route = createFileRoute('/invoices/review/$jobId')({
  component: InvoiceReviewWorkbenchPage,
})

function InvoiceReviewWorkbenchPage() {
  const { jobId } = Route.useParams()
  const [job, setJob] = useState<InvoiceReviewJob>(() => getOrCreateInvoiceJob(jobId))
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setJob(getOrCreateInvoiceJob(jobId))
    setZoom(100)
    setRotation(0)
    setCurrentPage(1)
  }, [jobId])

  const unmatchedCount = job.lineItems.filter((item) => !item.matched).length

  const updateJob = (updater: (currentJob: InvoiceReviewJob) => InvoiceReviewJob) => {
    setJob((currentJob) => {
      const nextJob = updater(currentJob)
      saveInvoiceJob(nextJob)
      return getOrCreateInvoiceJob(nextJob.jobId)
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
                  {getStatusLabel(job.status)}
                </Badge>
                <Badge variant="outline" className="rounded-lg">
                  {job.jobId}
                </Badge>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {job.fileName} · {formatInvoiceTimestamp(job.uploadedAt)}
              </p>
            </div>

            {unmatchedCount > 0 ? (
              <Badge variant="secondary" className="gap-1.5 rounded-lg bg-amber-100 text-amber-700">
                <AlertCircle className="h-3.5 w-3.5" />
                {unmatchedCount} 项未匹配
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1.5 rounded-lg bg-emerald-100 text-emerald-700">
                <CheckCircle className="h-3.5 w-3.5" />
                已完成全部映射
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="h-[45%] lg:h-full lg:w-[56%]">
            <DocumentPreview
              fileName={job.fileName}
              jobId={job.jobId}
              uploadedAtLabel={formatInvoiceTimestamp(job.uploadedAt)}
              currentPage={currentPage}
              totalPages={job.pageCount}
              zoom={zoom}
              rotation={rotation}
              onZoomIn={() => setZoom((value) => Math.min(200, value + 10))}
              onZoomOut={() => setZoom((value) => Math.max(50, value - 10))}
              onRotate={() => setRotation((value) => (value + 90) % 360)}
              onPreviousPage={() =>
                setCurrentPage((value) => Math.max(1, value - 1))
              }
              onNextPage={() =>
                setCurrentPage((value) => Math.min(job.pageCount, value + 1))
              }
            />
          </div>

          <div className="flex h-[55%] flex-col lg:h-full lg:w-[44%]">
            <div className="flex-1 space-y-6 overflow-auto p-6">
              <ReviewHeaderForm
                header={job.header}
                onFieldChange={handleHeaderFieldChange}
              />
              <ReviewTable
                lineItems={job.lineItems}
                ingredientOptions={ingredientOptions}
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
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1 rounded-lg"
                  onClick={() => saveInvoiceJob(job)}
                >
                  <Save className="mr-2 h-4 w-4" />
                  保存草稿
                </Button>
                <Button className="flex-1 rounded-lg" disabled={unmatchedCount > 0}>
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
