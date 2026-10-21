import { createFileRoute } from '@tanstack/react-router'
import { Portal } from '@/features/portal'

// Public wall display: outside _authenticated, no login needed.
export const Route = createFileRoute('/portal')({
  component: Portal,
})
