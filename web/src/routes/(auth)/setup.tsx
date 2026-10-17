import { createFileRoute, redirect } from '@tanstack/react-router'
import { meQuery, setupQuery } from '@/lib/api'
import { Onboarding } from '@/features/onboarding'

export const Route = createFileRoute('/(auth)/setup')({
  // Open to anyone while no admin exists; afterwards it needs a session.
  beforeLoad: async ({ context }) => {
    const setup = await context.queryClient.fetchQuery(setupQuery)
    if (!setup.needsAdmin) {
      try {
        await context.queryClient.ensureQueryData(meQuery)
      } catch {
        throw redirect({ to: '/sign-in', search: { redirect: '/setup' } })
      }
    }
    return { setup }
  },
  component: Onboarding,
})
