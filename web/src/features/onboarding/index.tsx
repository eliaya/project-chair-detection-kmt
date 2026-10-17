import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, Copy, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api, listQuery, meQuery, setupQuery, type Me } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { datetime, resources } from '@/features/resources/definitions'
import { type Field, FieldsForm } from '@/features/resources/fields-form'
import { thresholdFields, thresholdsQuery } from '@/features/thresholds/fields'
import { setupSchema, thresholdsSchema } from '../../../shared/schemas'

const route = getRouteApi('/(auth)/setup')
const FORM_ID = 'onboarding-form'

type StepKey = 'admin' | 'devices' | 'cameras' | 'zones' | 'thresholds' | 'done'
type ListKey = 'devices' | 'cameras' | 'zones'
type Row = Record<string, unknown> & { id: string }

const copy: Record<StepKey, { title: string; description: string }> = {
  admin: {
    title: '管理者を作成',
    description:
      'この管理画面に最初にログインするアカウントです。デプロイ時に設定した Setup code が必要です。',
  },
  devices: {
    title: 'デバイスを登録',
    description:
      'Raspberry Pi を登録すると、main.py が使う API トークンが発行されます。',
  },
  cameras: {
    title: 'カメラを登録',
    description: 'デバイスに接続した USB カメラのパスと解像度を設定します。',
  },
  zones: {
    title: 'ゾーンを設定',
    description: 'カメラ画像上の座席区域と、その中の卓・座席を設定します。',
  },
  thresholds: {
    title: '判定ルールを確認',
    description:
      '着席・離席の判定パラメータです。あとから「閾値」画面で変更できます。',
  },
  done: {
    title: '準備完了！',
    description:
      'Pi で main.py を起動すると、ダッシュボードに卓の稼働状況が表示されます。',
  },
}

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
  .extend({ password_confirm: z.string() })
  .refine((d) => d.password === d.password_confirm, {
    path: ['password_confirm'],
    message: 'パスワードが一致しません',
  })

// The block lays its form out in two columns; these fields take a full row.
const WIDE = new Set(['description', 'vertices', 'seats'])
const gridFields = (fields: Field[]) =>
  fields.map((f) => ({ ...f, wide: f.wide || WIDE.has(f.name) }))

// One-line summaries for rows already registered.
const describe: Record<ListKey, (r: Row) => string> = {
  devices: (r) =>
    `${r.name || '名前なし'} · 最終通信 ${datetime(r.last_seen_at)}`,
  cameras: (r) =>
    `${r.device_id} · ${r.device_path} · ${r.width}×${r.height} · ${r.fps} fps`,
  zones: (r) => {
    const tables = r.seats as string[][]
    return `${r.camera_id} · ${tables.length}卓 / ${tables.flat().length}席${r.description ? ` · ${r.description}` : ''}`
  },
}

export function Onboarding() {
  const { setup } = route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Wizard design tokens live on <html> so dialogs/toasts match (theme.css).
  useEffect(() => {
    document.documentElement.classList.add('onboarding')
    return () => document.documentElement.classList.remove('onboarding')
  }, [])

  const steps: StepKey[] = [
    ...(setup.needsAdmin ? (['admin'] as const) : []),
    'devices',
    'cameras',
    'zones',
    'thresholds',
    'done',
  ]
  const [chosen, setChosen] = useState<number | null>(null)
  const [furthest, setFurthest] = useState(0)
  const [adminCreated, setAdminCreated] = useState(false)
  const [adding, setAdding] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  const { data: me } = useQuery({ ...meQuery, enabled: !setup.needsAdmin })
  const lists = {
    devices: useQuery({ ...listQuery<Row>('devices'), enabled: !!me }).data,
    cameras: useQuery({ ...listQuery<Row>('cameras'), enabled: !!me }).data,
    zones: useQuery({ ...listQuery<Row>('zones'), enabled: !!me }).data,
  }
  const thresholds = useQuery({ ...thresholdsQuery, enabled: !!me }).data

  // Resume at the first step with nothing registered yet.
  const loaded = !!(lists.devices && lists.cameras && lists.zones)
  const firstOpen = steps.findIndex(
    (s) => s in lists && lists[s as ListKey]?.length === 0
  )
  const index =
    chosen ??
    (setup.needsAdmin
      ? 0
      : loaded
        ? firstOpen === -1
          ? steps.indexOf('thresholds')
          : firstOpen
        : null)
  const step = index === null ? null : steps[index]
  const minIndex = setup.needsAdmin && adminCreated ? 1 : 0

  const go = (i: number) => {
    setChosen(i)
    setFurthest((f) => Math.max(f, i, index ?? 0))
    setAdding(false)
  }
  const next = () => index !== null && go(index + 1)

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
      queryClient.setQueryData(setupQuery.queryKey, {
        ...setup,
        needsAdmin: false,
      })
      setAdminCreated(true)
      toast.success('管理者を作成しました')
      go(1)
    },
  })
  const create = useMutation({
    mutationFn: ({ key, values }: { key: ListKey; values: object }) =>
      api.post(`/${key}`, values).then((r) => r.data),
    onSuccess: async (data, { key }) => {
      // Refetch before moving on, so the next step can preselect the new row.
      await queryClient.invalidateQueries({ queryKey: [key] })
      toast.success('登録しました')
      // A new device stays on screen so its one-time token can be copied.
      if (data?.token) {
        setToken(data.token)
        setAdding(false)
      } else next()
    },
  })
  const saveThresholds = useMutation({
    mutationFn: (values: object) => api.put('/settings/thresholds', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: thresholdsQuery.queryKey })
      next()
    },
  })
  const pending =
    createAdmin.isPending || create.isPending || saveThresholds.isPending

  if (index === null || step === null)
    return (
      <div className='flex min-h-svh items-center justify-center'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )

  const list = step in lists ? lists[step as ListKey] : undefined
  const showForm =
    step === 'admin' ||
    step === 'thresholds' ||
    (!!list && (list.length === 0 || adding))
  const actionLabel =
    step === 'admin'
      ? 'アカウントを作成'
      : step === 'done'
        ? 'ダッシュボードへ'
        : step === 'thresholds'
          ? '保存して次へ'
          : showForm
            ? step === 'devices'
              ? '登録してトークンを発行'
              : '登録して次へ'
            : '次へ'

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
                  disabled={pending || (step === 'admin' && !setup.enabled)}
                  type={showForm ? 'submit' : 'button'}
                  form={showForm ? FORM_ID : undefined}
                  onClick={
                    showForm
                      ? undefined
                      : () => (step === 'done' ? navigate({ to: '/' }) : next())
                  }
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
              {step === 'admin' &&
                (setup.enabled ? (
                  <FieldsForm
                    key='admin'
                    id={FORM_ID}
                    fields={adminFields}
                    schema={adminFormSchema}
                    className='grid gap-4 sm:grid-cols-2'
                    onValid={({ password_confirm: _, ...values }) =>
                      createAdmin.mutate(values)
                    }
                  />
                ) : (
                  <ItemList
                    items={[
                      {
                        title: 'SETUP_TOKEN が未設定です',
                        description:
                          'npx wrangler secret put SETUP_TOKEN で設定してください（ローカルは web/.dev.vars）。',
                      },
                    ]}
                  />
                ))}

              {list && (
                <>
                  {step === 'devices' && token && <TokenBox token={token} />}
                  {list.length > 0 && (
                    <ItemList
                      items={list.map((r) => ({
                        title: r.id,
                        description: describe[step as ListKey](r),
                      }))}
                    />
                  )}
                  {showForm ? (
                    <FieldsForm
                      key={`${step}-${list.length}`}
                      id={FORM_ID}
                      fields={gridFields(resources[step as ListKey].fields)}
                      schema={resources[step as ListKey].createSchema}
                      initial={{
                        ...(step === 'cameras'
                          ? resources.cameras.defaults
                          : {}),
                        device_id: lists.devices?.[0]?.id,
                        camera_id: lists.cameras?.[0]?.id,
                      }}
                      className='grid gap-4 sm:grid-cols-2'
                      onValid={(values) =>
                        create.mutate({ key: step as ListKey, values })
                      }
                    />
                  ) : (
                    <Button
                      variant='outline'
                      className='self-start'
                      onClick={() => setAdding(true)}
                    >
                      <Plus /> 追加
                    </Button>
                  )}
                  {showForm && list.length > 0 && (
                    <Button
                      variant='ghost'
                      className='self-start'
                      onClick={() => setAdding(false)}
                    >
                      追加をやめる
                    </Button>
                  )}
                </>
              )}

              {step === 'thresholds' && thresholds && (
                <FieldsForm
                  key='thresholds'
                  id={FORM_ID}
                  fields={thresholdFields}
                  schema={thresholdsSchema}
                  initial={thresholds}
                  className='grid gap-4 sm:grid-cols-2'
                  onValid={(values) => saveThresholds.mutate(values)}
                />
              )}

              {step === 'done' && (
                <>
                  <ItemList
                    items={[
                      { title: '管理者', description: me?.email ?? '' },
                      {
                        title: 'デバイス',
                        description: `${lists.devices?.length ?? 0} 台`,
                      },
                      {
                        title: 'カメラ',
                        description: `${lists.cameras?.length ?? 0} 台`,
                      },
                      {
                        title: 'ゾーン',
                        description: `${lists.zones?.length ?? 0} 件`,
                      },
                    ]}
                  />
                  <div className='flex flex-col gap-2'>
                    <p className='text-sm font-medium'>Pi で実行</p>
                    <pre className='overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed'>
                      {`export API_TOKEN=${token ?? '<デバイスのトークン>'}\npython3 main.py --config ${window.location.origin}/api/config`}
                    </pre>
                  </div>
                </>
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

function TokenBox({ token }: { token: string }) {
  return (
    <div className='flex flex-col gap-2 rounded-2xl border bg-background p-4'>
      <span className='text-sm leading-none font-medium'>API トークン</span>
      <span className='text-sm text-muted-foreground'>
        二度と表示されません。Pi の環境変数 API_TOKEN に設定してください。
      </span>
      <div className='flex items-center gap-2'>
        <code className='min-w-0 flex-1 rounded-md bg-muted p-2 font-mono text-xs break-all select-all'>
          {token}
        </code>
        <Button
          variant='outline'
          size='icon'
          aria-label='トークンをコピー'
          onClick={() =>
            navigator.clipboard
              .writeText(token)
              .then(() => toast.success('コピーしました'))
          }
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}
