import { createFileRoute } from '@tanstack/react-router'
import { Site } from '@/features/site'

export const Route = createFileRoute('/admin/_authenticated/site/')({
  component: Site,
})
