import { createFileRoute } from '@tanstack/react-router'
import { FloorplanPage } from '@/features/floorplan'

export const Route = createFileRoute('/admin/_authenticated/floorplan/')({
  component: FloorplanPage,
})
