import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
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

const copy: Record<StepKey, { title: string; description: string }> = {
  site: {
    title: 'サイト名を設定',
    description:
      '監視する店舗・施設の名前です。管理画面のサイドバーに表示されます。',
  },
  admin: {
    title: '管理者を作成',
    description:
      'この管理画面に最初にログインするアカウントです。デプロイ時に設定した Setup code が必要です。',
  },
  done: {
    title: '準備完了！',
    description:
      '「デバイス」「カメラ」「ゾーン」を登録し、Pi で main.py を起動すると、ダッシュボードに卓の稼働状況が表示されます。',
  },
}

const siteFields: Field[] = [
  { name: 'site_name', label: 'サイト名', placeholder: '例: 本店', wide: true },
]
const siteSchema = setupSchema.pick({ site_name: true })

const adminFields: Field[] = [
  {
    name: 'setup_code',
    label: 'Setup code',
    type: 'password',
    description: 'wrangler secret put SETUP_TOKEN で設定した値です。',
    wide: true,
  },
  { name: 'email', label: 'メールアドレス', placeholder: 'admin@example.com' },
  { name: 'name', label: '名前' },
  {
    name: 'password',
    label: 'パスワード',
    type: 'password',
    description: '半角英数字・記号 8文字以上',
  },
  { name: 'password_confirm', label: 'パスワード（確認）', type: 'password' },
]
const adminFormSchema = setupSchema
  .omit({ site_name: true })
  .extend({ password_confirm: z.string() })
  .refine((d) => d.password === d.password_confirm, {
    path: ['password_confirm'],
    message: 'パスワードが一致しません',
  })

export function Onboarding() {
  const { setup } = route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

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
      toast.success('管理者を作成しました')
      go(steps.indexOf('done'))
    },
  })
  const pending = createAdmin.isPending
  const showForm = step !== 'done' && setup.enabled
  const actionLabel =
    step === 'site'
      ? '次へ'
      : step === 'admin'
        ? 'アカウントを作成'
        : 'ダッシュボードへ'

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
                  戻る
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
                  {copy[step].title}
                </h1>
                <p className='max-w-xs text-sm leading-relaxed text-muted-foreground'>
                  {copy[step].description}
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
                  aria-label='セットアップの進捗'
                  className='flex justify-center gap-1.5'
                >
                  <span className='sr-only'>
                    ステップ {index + 1} / {steps.length}
                  </span>
                  {steps.map((s, i) => (
                    <button
                      key={s}
                      type='button'
                      aria-label={`ステップ ${i + 1}: ${copy[s].title}`}
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
                      title: 'SETUP_TOKEN が未設定です',
                      description:
                        'npx wrangler secret put SETUP_TOKEN で設定してください（ローカルは web/.dev.vars）。',
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
                    { title: 'サイト名', description: siteName },
                    { title: '管理者', description: me?.email ?? '' },
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
