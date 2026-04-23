import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Camera, FileImage, Upload } from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createInvoiceJob,
  formatInvoiceTimestamp,
  getStatusLabel,
  listInvoiceJobs,
} from '@/features/invoices/mock-store'

export const Route = createFileRoute('/invoices/new')({
  component: InvoiceIntakePage,
})

function InvoiceIntakePage() {
  const navigate = useNavigate()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [recentJobs, setRecentJobs] = useState(() => listInvoiceJobs())

  const handleCreateJob = () => {
    if (!selectedFile) {
      return
    }

    const nextJob = createInvoiceJob(selectedFile.name)
    setRecentJobs(listInvoiceJobs())
    setSelectedFile(null)

    void navigate({
      to: '/invoices/review/$jobId',
      params: { jobId: nextJob.jobId },
    })
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-10">
        <div className="mb-8">
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">发票 intake</h1>
            <Badge variant="secondary" className="rounded-lg">
              Phase 4 本地版
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            当前页面只负责选择文件、创建 intake job，并跳转到指定任务的 review
            工作台。
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Camera className="h-4 w-4" />
                上传发票
              </CardTitle>
              <CardDescription>
                本 phase 先走本地 mock 流程，不接真实 OCR、Queue 和 D1。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-2xl border border-dashed border-muted-foreground/25 bg-muted/30 p-6">
                <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-background">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <Label htmlFor="invoice-file" className="text-base font-medium">
                    选择发票文件
                  </Label>
                  <p className="mt-2 text-sm text-muted-foreground">
                    支持图片或 PDF，当前仅模拟创建 intake job。
                  </p>
                  <Input
                    id="invoice-file"
                    type="file"
                    accept="image/*,.pdf"
                    className="mt-4 max-w-md rounded-lg"
                    onChange={(event) =>
                      setSelectedFile(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
              </div>

              <div className="rounded-xl border bg-background p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">待创建任务</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedFile
                        ? `${selectedFile.name} · ${formatFileSize(selectedFile.size)}`
                        : '尚未选择文件'}
                    </p>
                  </div>
                  <Badge variant={selectedFile ? 'default' : 'secondary'} className="rounded-lg">
                    {selectedFile ? '可创建' : '待选择'}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  className="flex-1 rounded-lg"
                  disabled={!selectedFile}
                  onClick={handleCreateJob}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  创建 intake 任务
                </Button>
                <Button variant="secondary" className="flex-1 rounded-lg" asChild>
                  <Link
                    to="/invoices/review/$jobId"
                    params={{ jobId: recentJobs[0]?.jobId ?? 'demo-metro-apr' }}
                  >
                    <FileImage className="mr-2 h-4 w-4" />
                    打开最近任务
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">最近任务</CardTitle>
              <CardDescription>
                使用本地 mock store 模拟 intake job 列表与 review 入口。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentJobs.map((job) => (
                <Link
                  key={job.jobId}
                  to="/invoices/review/$jobId"
                  params={{ jobId: job.jobId }}
                  className="block rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{job.fileName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {job.header.supplier || '待补充供应商'} ·
                        {' '}
                        {formatInvoiceTimestamp(job.uploadedAt)}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 rounded-lg">
                      {getStatusLabel(job.status)}
                    </Badge>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}

function formatFileSize(fileSize: number) {
  if (fileSize >= 1024 * 1024) {
    return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
  }

  return `${Math.max(1, Math.round(fileSize / 1024))} KB`
}
