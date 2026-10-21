import { createFileRoute, redirect } from '@tanstack/react-router'
import { setupQuery } from '@/lib/api'
import { Onboarding } from '@/features/onboarding'

export const Route = createFileRoute('/admin/(auth)/setup')({
  // Open only while no admin exists.
  beforeLoad: async ({ context }) => {
    const setup = await context.queryClient.fetchQuery(setupQuery)
    if (!setup.needsAdmin) throw redirect({ to: '/admin' })
    return { setup }
  },
  component: Onboarding,
})
