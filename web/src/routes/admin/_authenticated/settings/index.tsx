import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/_authenticated/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/appearance', replace: true })
  },
})
