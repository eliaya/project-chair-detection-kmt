import { z } from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { setupQuery } from '@/lib/api'
import { SignIn } from '@/features/auth/sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/admin/(auth)/sign-in')({
  beforeLoad: async ({ context }) => {
    const setup = await context.queryClient
      .fetchQuery(setupQuery)
      .catch(() => null)
    if (setup?.needsAdmin) throw redirect({ to: '/admin/setup' })
  },
  component: SignIn,
  validateSearch: searchSchema,
})
