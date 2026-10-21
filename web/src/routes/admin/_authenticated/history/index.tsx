import { createFileRoute } from '@tanstack/react-router'
import { History } from '@/features/history'

export const Route = createFileRoute('/admin/_authenticated/history/')({
  component: History,
})
