import { createFileRoute } from '@tanstack/react-router'
import { Thresholds } from '@/features/thresholds'

export const Route = createFileRoute('/admin/_authenticated/thresholds/')({
  component: Thresholds,
})
