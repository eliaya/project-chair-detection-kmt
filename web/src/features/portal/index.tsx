import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type PublicSeat } from '../../../shared/occupancy'
import { FloorplanTab } from './floorplan'

type PublicOccupancy = {
  now: string
  site_name: string | null
  empty_tables: number
  empty_seats: number
  used_seats: number
  unknown_seats: number
  cameras: { live: boolean; tables: PublicSeat[][] }[]
  zones: { id: string; empty_seats: number }[]
  floorplan: PublicSeat['state'][]
}

const green = 'text-emerald-600 dark:text-emerald-400'
const red = 'text-red-600 dark:text-red-400'
const seatClass: Record<PublicSeat['state'], string> = {
  empty:
    'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
  used: 'border-red-500/50 bg-red-500/15 text-red-800 dark:text-red-200',
  unknown: 'border-dashed border-muted-foreground/50 text-muted-foreground',
}

// Layout follows shadcnspace "Pricing 11": 16px-radius cards with a 1px border and
// no shadow, inside a muted 16px-radius panel.
export function Portal() {
  const { lang, t } = useI18n()
  // Plain fetch, not the axios api: main.tsx sends axios 401/500 errors to
  // /sign-in or /500, and a wall display must stay on this page.
  const { data, isError } = useQuery({
    queryKey: ['public', 'occupancy'],
    queryFn: async () => {
      const r = await fetch('/api/public/occupancy')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as PublicOccupancy
    },
    refetchInterval: 5000,
  })

  const stats = [
    { label: t('portal.emptyTables'), value: data?.empty_tables, tone: green },
    { label: t('portal.emptySeats'), value: data?.empty_seats, tone: green },
    { label: t('portal.usedSeats'), value: data?.used_seats, tone: red },
  ]
  const legend = [
    { label: t('portal.emptySeats'), state: 'empty' },
    { label: t('portal.usedSeats'), state: 'used' },
    { label: t('status.unknown'), state: 'unknown' },
  ] as const

  return (
    <main className='mx-auto flex min-h-svh max-w-[1800px] flex-col gap-10 px-4 py-10 sm:px-10 lg:px-16 lg:py-16'>
      <header className='flex flex-wrap items-end justify-between gap-4'>
        <div className='space-y-3'>
          <p className='text-lg text-muted-foreground'>
            {data?.site_name ?? t('app.title')}
          </p>
          <h1 className='text-4xl font-semibold tracking-tight sm:text-5xl'>
            {t('portal.title')}
          </h1>
        </div>
        <div className='space-y-1 text-lg text-muted-foreground sm:text-end'>
          {isError && (
            <p
              className='font-semibold text-red-600 dark:text-red-400'
              role='alert'
            >
              {t('portal.offline')}
            </p>
          )}
          {!!data?.unknown_seats && (
            <p>{t('portal.unknown', { n: data.unknown_seats })}</p>
          )}
          {data && (
            <p className='tabular-nums'>
              {t('portal.updated', {
                time: new Date(data.now).toLocaleTimeString(lang),
              })}
            </p>
          )}
        </div>
      </header>

      <div className='grid flex-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
        <Tabs
          defaultValue='cameras'
          className='gap-6 rounded-2xl bg-muted p-6 sm:p-12'
        >
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <TabsList className='h-11'>
              <TabsTrigger value='cameras' className='px-4 text-base'>
                {t('portal.cameras')}
              </TabsTrigger>
              <TabsTrigger value='floorplan' className='px-4 text-base'>
                {t('nav.floorplan')}
              </TabsTrigger>
            </TabsList>
            <ul className='flex flex-wrap gap-4 text-muted-foreground'>
              {legend.map((l) => (
                <li key={l.state} className='flex items-center gap-2'>
                  <span
                    className={cn('size-4 rounded border', seatClass[l.state])}
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          </div>
          <TabsContent value='cameras' className='grid gap-6 xl:grid-cols-2'>
            {data?.cameras.map((cam, i) => (
              <article
                key={i}
                className='space-y-5 rounded-2xl border bg-card p-6 sm:p-8'
              >
                <div className='flex items-center justify-between gap-2'>
                  <h3 className='text-2xl font-semibold'>
                    {t('portal.camera', { n: i + 1 })}
                  </h3>
                  <span
                    className={cn(
                      'flex items-center gap-2 text-muted-foreground',
                      cam.live && green
                    )}
                  >
                    <span
                      className={cn(
                        'size-2.5 rounded-full bg-muted-foreground',
                        cam.live && 'animate-pulse bg-emerald-500'
                      )}
                    />
                    {cam.live ? t('portal.live') : t('portal.cameraOffline')}
                  </span>
                </div>
                {cam.tables.length ? (
                  <div className='flex flex-wrap gap-3'>
                    {cam.tables.map((table, j) => (
                      <div
                        key={j}
                        className='flex gap-1.5 rounded-lg border p-1.5'
                      >
                        {table.map((seat, k) => (
                          <span
                            key={k}
                            title={seat.name}
                            className={cn(
                              'flex h-10 min-w-10 items-center justify-center rounded-md border px-1.5 text-sm font-medium',
                              seatClass[seat.state]
                            )}
                          >
                            {seat.name}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className='text-muted-foreground'>{t('portal.noSeats')}</p>
                )}
              </article>
            ))}
          </TabsContent>
          <TabsContent
            value='floorplan'
            className='overflow-hidden rounded-2xl border bg-card p-2'
          >
            <FloorplanTab
              states={data?.floorplan ?? []}
              zones={data?.zones ?? []}
            />
          </TabsContent>
        </Tabs>

        {/* On a phone the counts come first. */}
        <section className='order-first grid gap-6 lg:order-none'>
          {stats.map((s) => (
            <div
              key={s.label}
              className='flex flex-col justify-center rounded-2xl border bg-card p-8'
            >
              <h2 className='text-2xl font-semibold text-muted-foreground sm:text-3xl'>
                {s.label}
              </h2>
              <div
                className={cn(
                  'text-[clamp(4.5rem,9vw,11rem)] leading-none font-semibold tabular-nums',
                  s.tone
                )}
              >
                {s.value ?? '—'}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
