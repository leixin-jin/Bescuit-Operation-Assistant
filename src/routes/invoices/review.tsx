import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Camera, Clock3 } from 'lucide-react'

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

export const Route = createFileRoute('/invoices/review')({
  component: InvoiceReviewPlaceholderPage,
})

function InvoiceReviewPlaceholderPage() {
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
          <h1 className="text-2xl font-bold">发票核对工作台</h1>
          <p className="mt-1 text-muted-foreground">
            Phase 4 会把上传入口和 review 工作台拆成正式路由。
          </p>
        </div>

        <Card className="max-w-2xl rounded-xl">
          <CardHeader>
            <Badge variant="secondary" className="mb-3 w-fit rounded-lg">
              Phase 4 占位页
            </Badge>
            <CardTitle>当前已预留导航入口和页面壳子</CardTitle>
            <CardDescription>
              下一阶段会补 `/invoices/new` 与 `/invoices/review/$jobId`，并接上上传、队列和 AI
              处理链路。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row">
            <Button className="rounded-lg" disabled>
              <Camera className="mr-2 h-4 w-4" />
              拍照上传（待 Phase 4）
            </Button>
            <Button variant="secondary" className="rounded-lg" disabled>
              <Clock3 className="mr-2 h-4 w-4" />
              查看任务队列（待 Phase 4）
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
