import { createFileRoute } from '@tanstack/react-router'
import { FloorplanPage } from '@/features/floorplan'

export const Route = createFileRoute('/_authenticated/floorplan/')({
  component: FloorplanPage,
})
