import {
  ChevronLeft,
  ChevronRight,
  FileImage,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface DocumentPreviewProps {
  fileName: string
  jobId: string
  uploadedAtLabel: string
  currentPage: number
  totalPages: number
  zoom: number
  rotation: number
  onZoomIn: () => void
  onZoomOut: () => void
  onRotate: () => void
  onPreviousPage: () => void
  onNextPage: () => void
}

export function DocumentPreview({
  fileName,
  jobId,
  uploadedAtLabel,
  currentPage,
  totalPages,
  zoom,
  rotation,
  onZoomIn,
  onZoomOut,
  onRotate,
  onPreviousPage,
  onNextPage,
}: DocumentPreviewProps) {
  return (
    <div className="flex h-full flex-col border-b bg-muted/30 lg:border-r lg:border-b-0">
      <div className="border-b bg-background px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="rounded-lg">
            文档预览
          </Badge>
          <Badge variant="outline" className="rounded-lg">
            {jobId}
          </Badge>
        </div>
        <h2 className="mt-3 text-lg font-semibold">{fileName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">上传时间: {uploadedAtLabel}</p>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div
          className="flex h-full max-h-[780px] w-full max-w-[560px] items-center justify-center rounded-2xl border border-dashed border-muted-foreground/25 bg-white p-8 shadow-sm"
          style={{
            transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
          }}
        >
          <div className="w-full max-w-sm rounded-xl border bg-slate-50 p-8 text-slate-700">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  Invoice
                </p>
                <p className="mt-2 text-sm font-medium">{fileName}</p>
              </div>
              <FileImage className="h-8 w-8 text-slate-400" />
            </div>
            <div className="space-y-3 text-sm">
              <div className="h-3 rounded-full bg-slate-200" />
              <div className="h-3 w-4/5 rounded-full bg-slate-200" />
              <div className="h-3 w-3/5 rounded-full bg-slate-200" />
              <div className="h-px bg-slate-200" />
              <div className="grid gap-2">
                <div className="h-10 rounded-lg bg-slate-100" />
                <div className="h-10 rounded-lg bg-slate-100" />
                <div className="h-10 rounded-lg bg-slate-100" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-lg"
            onClick={onZoomOut}
          >
            <ZoomOut />
          </Button>
          <span className="min-w-14 text-center text-sm">{zoom}%</span>
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-lg"
            onClick={onZoomIn}
          >
            <ZoomIn />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-lg"
            onClick={onRotate}
          >
            <RotateCw />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-lg"
            disabled={currentPage <= 1}
            onClick={onPreviousPage}
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-lg"
            disabled={currentPage >= totalPages}
            onClick={onNextPage}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
