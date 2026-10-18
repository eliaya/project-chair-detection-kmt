import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { type Key, useI18n } from '@/i18n'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, meQuery, setupQuery, siteNameQuery, type Me } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { type Field, FieldsForm } from '@/features/resources/fields-form'
import { setupSchema } from '../../../shared/schemas'

const route = getRouteApi('/(auth)/setup')
const FORM_ID = 'onboarding-form'

const steps = ['site', 'admin', 'done'] as const
type StepKey = (typeof steps)[number]

const copy: Record<StepKey, { title: Key; description: Key }> = {
  site: { title: 'onboarding.siteTitle', description: 'site.desc' },
  admin: {
    title: 'onboarding.adminTitle',
    description: 'onboarding.adminDesc',
  },
  done: { title: 'onboarding.doneTitle', description: 'onboarding.doneDesc' },
}

const siteFields: Field[] = [
  {
    name: 'site_name',
    label: 'site.name',
    placeholder: 'site.namePlaceholder',
    wide: true,
  },
]
const siteSchema = setupSchema.pick({ site_name: true })

const adminFields: Field[] = [
  {
    name: 'setup_code',
    label: 'onboarding.setupCode',
    type: 'password',
    description: 'onboarding.setupCodeHint',
    wide: true,
  },
  { name: 'email', label: 'field.email', placeholder: 'admin@example.com' },
  { name: 'name', label: 'field.name' },
  {
    name: 'password',
    label: 'field.password',
    type: 'password',
    description: 'onboarding.passwordHint',
  },
  {
    name: 'password_confirm',
    label: 'onboarding.passwordConfirm',
    type: 'password',
  },
]
const adminFormSchema = setupSchema
  .omit({ site_name: true })
  .extend({ password_confirm: z.string() })
  .refine((d) => d.password === d.password_confirm, {
    path: ['password_confirm'],
    message: 'validation.passwordMismatch',
  })

export function Onboarding() {
  const { setup } = route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useI18n()

  // Wizard design tokens live on <html> so dialogs/toasts match (theme.css).
  useEffect(() => {
    document.documentElement.classList.add('onboarding')
    return () => document.documentElement.classList.remove('onboarding')
  }, [])

  const [index, setIndex] = useState(0)
  const [furthest, setFurthest] = useState(0)
  const [siteName, setSiteName] = useState('')
  const [me, setMe] = useState<Me | null>(null)
  const step = steps[index]
  // Nothing to go back to once the admin exists.
  const minIndex = me ? steps.indexOf('done') : 0

  const go = (i: number) => {
    setIndex(i)
    setFurthest((f) => Math.max(f, i))
  }

  // Move focus to the new heading so screen readers announce the step.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) firstRender.current = false
    else headingRef.current?.focus()
  }, [index])

  const createAdmin = useMutation({
    mutationFn: (values: object) =>
      api.post<Me>('/setup', values).then((r) => r.data),
    onSuccess: (created) => {
      queryClient.setQueryData(meQuery.queryKey, created)
      queryClient.setQueryData(siteNameQuery.queryKey, siteName)
      queryClient.setQueryData(setupQuery.queryKey, {
        ...setup,
        needsAdmin: false,
      })
      setMe(created)
      toast.success(t('onboarding.adminCreated'))
      go(steps.indexOf('done'))
    },
  })
  const pending = createAdmin.isPending
  const showForm = step !== 'done' && setup.enabled
  const actionLabel = t(
    step === 'site'
      ? 'common.next'
      : step === 'admin'
        ? 'onboarding.createAccount'
        : 'onboarding.toDashboard'
  )

  return (
    <div className='flex min-h-svh items-center bg-background py-8 sm:py-16'>
      <div className='mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8'>
        <div className='flex flex-col overflow-hidden rounded-xl bg-muted shadow-[0_1px_3px_0_oklch(0_0_0/0.05)] ring-1 ring-foreground/10 md:grid md:min-h-[612px] md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)] md:gap-6'>
          {/* Left: step copy, primary action and progress (contents on mobile so the form sits between) */}
          <div className='max-md:contents md:flex md:flex-col md:p-10'>
            <div className='h-5 max-md:order-1 max-md:px-6 max-md:pt-6'>
              {index > minIndex && (
                <Button
                  variant='ghost'
                  className='h-5 gap-1 p-0 hover:bg-transparent has-[>svg]:px-0'
                  onClick={() => go(index - 1)}
                  disabled={pending}
                >
                  <ChevronLeft className='size-4' />
                  {t('common.back')}
                </Button>
              )}
            </div>
            <div className='max-md:contents md:flex md:flex-1 md:flex-col md:justify-between md:gap-10'>
              <div className='flex flex-col gap-3 max-md:order-2 max-md:px-6 max-md:pt-4 max-md:pb-6'>
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className='text-4xl leading-tight font-bold tracking-tight text-balance outline-none'
                >
                  {t(copy[step].title)}
                </h1>
                <p className='max-w-xs text-sm leading-relaxed text-muted-foreground'>
                  {t(copy[step].description)}
                </p>
              </div>
              <div className='flex flex-col gap-5 max-md:order-4 max-md:p-6'>
                <Button
                  // Separate elements: a reused button could turn into the next step's submit mid-click.
                  key={showForm ? `submit-${step}` : `next-${step}`}
                  className='h-10 w-full'
                  disabled={pending || (step !== 'done' && !setup.enabled)}
                  type={showForm ? 'submit' : 'button'}
                  form={showForm ? FORM_ID : undefined}
                  onClick={showForm ? undefined : () => navigate({ to: '/' })}
                >
                  {pending && <Loader2 className='animate-spin' />}
                  {actionLabel}
                </Button>
                <nav
                  aria-label={t('onboarding.progress')}
                  className='flex justify-center gap-1.5'
                >
                  <span className='sr-only'>
                    {t('onboarding.stepOf', {
                      n: index + 1,
                      total: steps.length,
                    })}
                  </span>
                  {steps.map((s, i) => (
                    <button
                      key={s}
                      type='button'
                      aria-label={t('onboarding.stepLabel', {
                        n: i + 1,
                        title: t(copy[s].title),
                      })}
                      aria-current={i === index ? 'step' : undefined}
                      disabled={
                        pending || i < minIndex || i > Math.max(furthest, index)
                      }
                      onClick={() => go(i)}
                      className={cn(
                        // 8px dots get a larger invisible hit area.
                        'relative h-2 rounded-full transition-all duration-200 after:absolute after:-inset-x-[3px] after:-inset-y-3 disabled:cursor-default motion-reduce:transition-none',
                        i === index
                          ? 'w-5 bg-primary'
                          : 'w-2 bg-muted-foreground/30'
                      )}
                    />
                  ))}
                </nav>
              </div>
            </div>
          </div>

          {/* Right: the step's form or result */}
          <div className='flex justify-center bg-background p-6 max-md:order-3 md:p-10'>
            <div className='flex w-full flex-col gap-4'>
              {!setup.enabled && (
                <ItemList
                  items={[
                    {
                      title: t('onboarding.setupDisabledTitle'),
                      description: t('onboarding.setupDisabledDesc'),
                    },
                  ]}
                />
              )}

              {showForm && step === 'site' && (
                <FieldsForm
                  key='site'
                  id={FORM_ID}
                  fields={siteFields}
                  schema={siteSchema}
                  initial={{ site_name: siteName }}
                  className='grid gap-4 sm:grid-cols-2'
                  onValid={(values) => {
                    setSiteName(String(values.site_name))
                    go(index + 1)
                  }}
                />
              )}

              {showForm && step === 'admin' && (
                <FieldsForm
                  key='admin'
                  id={FORM_ID}
                  fields={adminFields}
                  schema={adminFormSchema}
                  className='grid gap-4 sm:grid-cols-2'
                  onValid={({ password_confirm: _, ...values }) =>
                    createAdmin.mutate({ ...values, site_name: siteName })
                  }
                />
              )}

              {step === 'done' && (
                <ItemList
                  items={[
                    { title: t('site.name'), description: siteName },
                    { title: t('field.admin'), description: me?.email ?? '' },
                  ]}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Bordered list from the block's settings step: 14px medium title, muted description.
function ItemList({
  items,
}: {
  items: { title: string; description: string }[]
}) {
  return (
    <ul className='divide-y overflow-hidden rounded-2xl border bg-background'>
      {items.map((item) => (
        <li key={item.title} className='flex flex-col gap-0.5 p-4'>
          <span className='text-sm leading-none font-medium'>{item.title}</span>
          <span className='text-sm text-muted-foreground'>
            {item.description}
          </span>
        </li>
      ))}
    </ul>
  )
}
