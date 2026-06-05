import { toast } from '@/hooks/use-toast'

export const ENTRY_COMPLETION_TOAST_DURATION_MS = 3000

export function showEntryCompletionToast(message: string) {
  toast({
    title: '输入完成',
    description: message,
    duration: ENTRY_COMPLETION_TOAST_DURATION_MS,
  })
}
