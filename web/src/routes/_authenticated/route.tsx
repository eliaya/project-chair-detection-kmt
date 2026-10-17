import { createFileRoute, redirect } from '@tanstack/react-router'
import { meQuery, setupQuery } from '@/lib/api'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery)
    } catch {
      // A fresh install has no admin yet: start the setup wizard instead.
      const setup = await context.queryClient
        .fetchQuery(setupQuery)
        .catch(() => null)
      throw setup?.needsAdmin
        ? redirect({ to: '/setup' })
        : redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  component: AuthenticatedLayout,
})
