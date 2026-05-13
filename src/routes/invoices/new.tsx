import { useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  FileImage,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
  formatInvoiceUploadLimit,
  INVOICE_UPLOAD_ACCEPT,
  MAX_INVOICE_UPLOAD_SIZE_BYTES,
  validateInvoiceUpload,
} from '@/features/invoices/intake-file-validation'
import { isInvoiceJobDeletable } from '@/lib/server/app-domain'
import {
  createInvoiceIntakeJob,
  deleteInvoiceIntakeJob,
} from '@/lib/server/mutations/invoices'
import {
  deleteInvoiceIntakeJobServerFn,
  uploadInvoiceIntakeDocument,
} from '@/lib/server/mutations/invoices.rpc'
import {
  formatInvoiceTimestamp,
  getInvoiceStatusLabel,
  listInvoiceJobs,
} from '@/lib/server/queries/invoices'
import {
  getInvoicePipelineEnabled,
  listInvoiceJobsServerFn,
} from '@/lib/server/queries/invoices.rpc'

export const Route = createFileRoute('/invoices/new')({
  loader: async () => {
    const pipelineEnabled = await getInvoicePipelineEnabled()
    const recentJobs = pipelineEnabled
      ? await listInvoiceJobsServerFn()
      : await listInvoiceJobs()

    return {
      pipelineEnabled,
      recentJobs,
    }
  },
  component: InvoiceIntakePage,
})

function InvoiceIntakePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const loaderData = Route.useLoaderData()
  const { pipelineEnabled } = loaderData
  const [selectedFiles, setSelectedFiles] = useState<SelectedInvoiceFile[]>([])
  const [fileErrorMessage, setFileErrorMessage] = useState<string | null>(null)

  const recentJobsQuery = useQuery({
    queryKey: ['invoice-jobs', pipelineEnabled],
    queryFn: () =>
      pipelineEnabled ? listInvoiceJobsServerFn() : listInvoiceJobs(),
    initialData: loaderData.recentJobs,
  })
  const recentJobs = recentJobsQuery.data ?? []

  const createJobMutation = useMutation<{ jobId: string }, Error, File>({
    mutationFn: async (file: File) => {
      const result = pipelineEnabled
        ? await uploadInvoiceIntakeDocument({
            data: createUploadFormData(file),
          })
        : await createInvoiceIntakeJob(file.name)

      return {
        jobId: result.jobId,
      }
    },
    onSuccess: async () => {
      setFileErrorMessage(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice-jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        router.invalidate(),
      ])
    },
    onError: (error) => {
      setFileErrorMessage(
        error instanceof Error ? error.message : '创建 intake 任务失败。',
      )
    },
  })

  const deleteJobMutation = useMutation<
    { ok: boolean; deleted: boolean },
    Error,
    string
  >({
    mutationFn: (jobId) =>
      pipelineEnabled
        ? deleteInvoiceIntakeJobServerFn({ data: { jobId } })
        : deleteInvoiceIntakeJob(jobId),
    onSuccess: async () => {
      setFileErrorMessage(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice-jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        router.invalidate(),
      ])
    },
    onError: (error) => {
      setFileErrorMessage(
        error instanceof Error ? error.message : '删除 intake 任务失败。',
      )
    },
  })

  const handleCreateJobs = async () => {
    if (selectedFiles.length === 0 || createJobMutation.isPending) {
      return
    }

    const validFiles = selectedFiles.filter((item) => item.validation.isValid)
    if (validFiles.length === 0) {
      setFileErrorMessage('没有可上传的有效文件。')
      return
    }

    setFileErrorMessage(null)

    for (const item of validFiles) {
      setSelectedFiles((currentFiles) =>
        currentFiles.map((currentFile) =>
          currentFile.id === item.id
            ? { ...currentFile, status: 'uploading', errorMessage: null }
            : currentFile,
        ),
      )

      try {
        const result = await createJobMutation.mutateAsync(item.file)
        setSelectedFiles((currentFiles) =>
          currentFiles.map((currentFile) =>
            currentFile.id === item.id
              ? { ...currentFile, status: 'created', jobId: result.jobId }
              : currentFile,
          ),
        )
      } catch (error) {
        setSelectedFiles((currentFiles) =>
          currentFiles.map((currentFile) =>
            currentFile.id === item.id
              ? {
                  ...currentFile,
                  status: 'error',
                  errorMessage:
                    error instanceof Error ? error.message : '创建 intake 任务失败。',
                }
              : currentFile,
          ),
        )
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['invoice-jobs'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      router.invalidate(),
    ])
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])

    if (files.length === 0) {
      setSelectedFiles([])
      setFileErrorMessage(null)
      return
    }

    const nextFiles = files.map(createSelectedInvoiceFile)
    const invalidCount = nextFiles.filter((file) => !file.validation.isValid).length

    setSelectedFiles(nextFiles)
    setFileErrorMessage(
      invalidCount > 0 ? `${invalidCount} 个文件未通过校验，请查看列表。` : null,
    )
    event.target.value = ''
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
              {pipelineEnabled ? 'Phase 6 异步链路' : 'Phase 5 本地版'}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {pipelineEnabled
              ? '当前页面会把文件写入 R2、登记 source document、创建 intake job，并投递到 Queue。'
              : '当前页面只负责选择文件、创建 intake job，并跳转到指定任务的 review 工作台。'}
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
                {pipelineEnabled
                  ? '上传顺序固定为 R2 -> source_documents -> intake_jobs -> Queue。'
                  : '当前通过 query/mutation 边界管理 intake job，后续可直接切换到真实 D1。'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-2xl border border-dashed border-muted-foreground/25 bg-muted/30 p-6">
                <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-background">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <Label htmlFor="invoice-file" className="text-base font-medium">
                    拍照或上传 PDF/图片
                  </Label>
                  <p className="mt-2 text-sm text-muted-foreground">
                    支持 PDF 或常见图片格式，单文件不超过{' '}
                    {formatInvoiceUploadLimit(MAX_INVOICE_UPLOAD_SIZE_BYTES)}，
                    {pipelineEnabled
                      ? '上传后会自动进入异步抽取链路。'
                      : '当前仅模拟创建 intake job。'}
                  </p>
                  <Input
                    id="invoice-file"
                    type="file"
                    accept={INVOICE_UPLOAD_ACCEPT}
                    multiple
                    className="mt-4 max-w-md rounded-lg"
                    onChange={handleFileChange}
                  />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Label
                      htmlFor="invoice-camera-file"
                      className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                    >
                      <Camera className="mr-2 h-4 w-4" />
                      手机拍照
                    </Label>
                    <Input
                      id="invoice-camera-file"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                  </div>
                  {fileErrorMessage ? (
                    <p className="mt-3 text-sm text-destructive">
                      {fileErrorMessage}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border bg-background p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">待创建任务</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedFiles.length > 0
                        ? `${selectedFiles.length} 个文件待处理`
                        : '尚未选择文件'}
                    </p>
                  </div>
                  <Badge
                    variant={hasCreatableFiles(selectedFiles) ? 'default' : 'secondary'}
                    className="rounded-lg"
                  >
                    {hasCreatableFiles(selectedFiles)
                      ? '可创建'
                      : fileErrorMessage
                        ? '校验失败'
                        : '待选择'}
                  </Badge>
                </div>
                {selectedFiles.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {selectedFiles.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.file.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatFileSize(item.file.size)} ·{' '}
                            {item.file.type || '未知类型'}
                          </p>
                          {!item.validation.isValid || item.errorMessage ? (
                            <p className="mt-1 text-xs text-destructive">
                              {item.validation.errorMessage ?? item.errorMessage}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {item.jobId ? (
                            <Button variant="secondary" size="sm" className="rounded-lg" asChild>
                              <Link
                                to="/invoices/review/$jobId"
                                params={{ jobId: item.jobId }}
                              >
                                打开
                              </Link>
                            </Button>
                          ) : null}
                          <FileStatusBadge item={item} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  className="flex-1 rounded-lg"
                  disabled={!hasCreatableFiles(selectedFiles) || createJobMutation.isPending}
                  onClick={() => void handleCreateJobs()}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  {createJobMutation.isPending ? '创建中...' : '创建 intake 任务'}
                </Button>
                {recentJobs[0] ? (
                  <Button variant="secondary" className="flex-1 rounded-lg" asChild>
                    <Link
                      to="/invoices/review/$jobId"
                      params={{ jobId: recentJobs[0].jobId }}
                    >
                      <FileImage className="mr-2 h-4 w-4" />
                      打开最近任务
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" className="flex-1 rounded-lg" disabled>
                    <FileImage className="mr-2 h-4 w-4" />
                    暂无最近任务
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">最近任务</CardTitle>
              <CardDescription>
                route 只消费查询结果，任务状态由统一的数据边界返回。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentJobs.length > 0 ? (
                recentJobs.map((job) => {
                  const canDelete = isInvoiceJobDeletable(job)
                  const isDeleting =
                    deleteJobMutation.isPending &&
                    deleteJobMutation.variables === job.jobId

                  return (
                    <div
                      key={job.jobId}
                      className="flex items-start gap-3 rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
                    >
                      <Link
                        to="/invoices/review/$jobId"
                        params={{ jobId: job.jobId }}
                        className="min-w-0 flex-1"
                      >
                        <span className="block truncate font-medium">
                          {job.fileName}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {job.header.supplier || '待补充供应商'} ·{' '}
                          {formatInvoiceTimestamp(job.uploadedAt)}
                        </span>
                      </Link>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary" className="rounded-lg">
                          {getInvoiceStatusLabel(job.status)}
                        </Badge>
                        {canDelete ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-lg text-muted-foreground hover:text-destructive"
                                aria-label={`删除 ${job.fileName}`}
                                disabled={isDeleting}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>删除最近任务</AlertDialogTitle>
                                <AlertDialogDescription>
                                  这会从最近任务中删除 {job.fileName}
                                  ，真实链路还会删除对应的原始文件。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-white hover:bg-destructive/90"
                                  disabled={isDeleting}
                                  onClick={() =>
                                    deleteJobMutation.mutate(job.jobId)
                                  }
                                >
                                  {isDeleting ? '删除中...' : '删除任务'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  当前还没有 intake job。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}

type SelectedInvoiceFileStatus = 'pending' | 'uploading' | 'created' | 'error'

interface SelectedInvoiceFile {
  id: string
  file: File
  validation: ReturnType<typeof validateInvoiceUpload>
  status: SelectedInvoiceFileStatus
  jobId?: string
  errorMessage?: string | null
}

function createSelectedInvoiceFile(file: File): SelectedInvoiceFile {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    validation: validateInvoiceUpload(file),
    status: 'pending',
    errorMessage: null,
  }
}

function hasCreatableFiles(files: SelectedInvoiceFile[]) {
  return files.some((file) => file.validation.isValid && file.status !== 'created')
}

function FileStatusBadge({ item }: { item: SelectedInvoiceFile }) {
  if (!item.validation.isValid || item.status === 'error') {
    return (
      <Badge variant="secondary" className="gap-1 rounded-lg bg-rose-100 text-rose-700">
        <XCircle className="h-3.5 w-3.5" />
        失败
      </Badge>
    )
  }

  if (item.status === 'created') {
    return (
      <Badge
        variant="secondary"
        className="gap-1 rounded-lg bg-emerald-100 text-emerald-700"
      >
        <CheckCircle className="h-3.5 w-3.5" />
        已创建
      </Badge>
    )
  }

  if (item.status === 'uploading') {
    return (
      <Badge variant="secondary" className="rounded-lg">
        创建中
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="rounded-lg">
      待上传
    </Badge>
  )
}

function formatFileSize(fileSize: number) {
  if (fileSize >= 1024 * 1024) {
    return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
  }

  return `${Math.max(1, Math.round(fileSize / 1024))} KB`
}

function createUploadFormData(file: File) {
  const formData = new FormData()
  formData.set('file', file)
  return formData
}
