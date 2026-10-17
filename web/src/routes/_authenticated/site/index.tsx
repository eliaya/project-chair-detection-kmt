import { createFileRoute } from '@tanstack/react-router'
import { Site } from '@/features/site'

export const Route = createFileRoute('/_authenticated/site/')({
  component: Site,
})
