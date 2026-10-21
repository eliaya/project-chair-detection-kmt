import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type PublicOccupancy = {
  now: string
  site_name: string | null
  empty_tables: number
  empty_seats: number
  used_seats: number
  unknown_seats: number
}

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
    {
      label: t('portal.emptyTables'),
      value: data?.empty_tables,
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: t('portal.emptySeats'),
      value: data?.empty_seats,
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: t('portal.usedSeats'),
      value: data?.used_seats,
      tone: 'text-red-600 dark:text-red-400',
    },
  ]

  return (
    <main className='flex min-h-svh flex-col gap-8 p-6 sm:p-10'>
      <h1 className='text-center text-3xl font-bold sm:text-5xl'>
        {data?.site_name ?? t('app.title')}
      </h1>
      <div className='grid flex-1 content-center gap-10 md:grid-cols-3'>
        {stats.map((s) => (
          <div key={s.label} className='text-center'>
            <div className='text-2xl font-medium text-muted-foreground sm:text-4xl'>
              {s.label}
            </div>
            <div
              className={cn(
                'text-[clamp(5rem,16vw,16rem)] leading-none font-black tabular-nums',
                s.tone
              )}
            >
              {s.value ?? '—'}
            </div>
          </div>
        ))}
      </div>
      <footer className='space-y-1 text-center text-lg text-muted-foreground'>
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
      </footer>
    </main>
  )
}
