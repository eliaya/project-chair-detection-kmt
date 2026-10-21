import { type z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type I18n, useI18n } from '@/i18n'
import { api, listQuery } from '@/lib/api'
import { type TableStatus } from '@/lib/seat-status'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PageShell } from '@/components/layout/page-shell'
import { type CameraStatus } from '@/features/resources/connection'
import { seatId, trustedCameras } from '../../../shared/occupancy'
import { type SeatStatus, type zoneSchema } from '../../../shared/schemas'

type Zone = z.infer<typeof zoneSchema>
type Current = {
  now: string
  seats: {
    seat_id: string
    device_id: string
    status: SeatStatus
    since: string
  }[]
  // Judged by the Worker: Pi offline (90 s) or camera failure.
  cameras: { id: string; status: CameraStatus }[]
}

const statusClass: Record<TableStatus, string> = {
  empty:
    'border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  confirming:
    'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  occupied: 'border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200',
  leave_confirm:
    'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  unknown: 'border-dashed text-muted-foreground',
}

// A table takes the most "in use" status of its seats: one seated person makes it in use.
const tablePriority: TableStatus[] = [
  'occupied',
  'leave_confirm',
  'confirming',
  'unknown',
  'empty',
]
const isSeated = (s: TableStatus) => s === 'occupied' || s === 'leave_confirm'

const elapsed = (ms: number, t: I18n['t']) => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return m < 60
    ? t('time.minutes', { m })
    : t('time.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 })
}

export function Dashboard() {
  const { t } = useI18n()
  const zones = useQuery(listQuery<Zone>('zones'))
  const current = useQuery({
    queryKey: ['occupancy', 'current'],
    queryFn: () => api.get<Current>('/occupancy/current').then((r) => r.data),
    refetchInterval: 5000,
  })

  // Server time, so a skewed browser clock does not skew the timers.
  const now = current.data ? Date.parse(current.data.now) : 0
  const seats = new Map(current.data?.seats.map((s) => [s.seat_id, s]))
  const cameraStatus = new Map(
    current.data?.cameras.map((c) => [c.id, c.status])
  )
  const zoneTables = (zones.data ?? []).map((zone) => {
    const camera = cameraStatus.get(zone.camera_id) ?? 'offline'
    return {
      zone,
      camera,
      tables: zone.seats.map((tableSeats, i) => {
        const seatStates = tableSeats.map((seat, j) => {
          const s = seats.get(seatId(zone.id, i, j))
          const status: TableStatus =
            s && trustedCameras.includes(camera) ? s.status : 'unknown'
          return { name: seat.name, status, since: s?.since }
        })
        const seated = seatStates.filter((s) => isSeated(s.status))
        return {
          seats: seatStates,
          status: tablePriority.find((p) =>
            seatStates.some((s) => s.status === p)
          )!,
          seated: seated.length,
          // In use since the first of its current guests sat down.
          since: seated
            .map((s) => s.since)
            .filter(Boolean)
            .sort()[0],
        }
      }),
    }
  })
  const all = zoneTables.flatMap((z) => z.tables)
  const inUse = all.filter((table) => isSeated(table.status)).length
  const unknown = all.filter((table) => table.status === 'unknown').length
  const known = all.length - unknown

  return (
    <PageShell title={t('nav.dashboard')} description={t('dashboard.desc')}>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Stat label={t('dashboard.tables')} value={all.length} />
        <Stat label={t('dashboard.inUse')} value={inUse} />
        <Stat
          label={t('dashboard.utilization')}
          value={known ? `${Math.round((inUse / known) * 100)}%` : '—'}
          hint={t('dashboard.utilizationHint')}
        />
        <Stat
          label={t('status.unknown')}
          value={unknown}
          hint={t('dashboard.unknownHint')}
        />
      </div>

      {zones.data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.emptyTitle')}</CardTitle>
            <CardDescription>{t('dashboard.emptyDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to='/devices'>{t('dashboard.registerDevice')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {zoneTables.map(({ zone, camera, tables }) => (
        <Card key={zone.id}>
          <CardHeader>
            <CardTitle>{zone.id}</CardTitle>
            <CardDescription>{zone.description}</CardDescription>
            {!trustedCameras.includes(camera) && (
              <p className='text-sm text-red-700 dark:text-red-300'>
                {t('dashboard.cameraProblem', {
                  camera: zone.camera_id,
                  status: t(`cameraStatus.${camera}`),
                })}
              </p>
            )}
          </CardHeader>
          <CardContent className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
            {tables.map((table, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg border p-3',
                  statusClass[table.status]
                )}
              >
                <div className='flex flex-wrap gap-x-2 text-sm'>
                  {table.seats.map((seat) => (
                    <span
                      key={seat.name}
                      className={cn(!isSeated(seat.status) && 'opacity-60')}
                      title={t(`status.${seat.status}`)}
                    >
                      {seat.name}
                    </span>
                  ))}
                </div>
                <div className='mt-1 flex items-baseline justify-between gap-2'>
                  <span className='font-semibold'>
                    {t(`status.${table.status}`)}
                  </span>
                  <span className='text-xs tabular-nums'>
                    {t('dashboard.seated', {
                      n: table.seated,
                      total: table.seats.length,
                    })}
                  </span>
                </div>
                {table.since && (
                  <div className='text-xs tabular-nums'>
                    {elapsed(now - Date.parse(table.since), t)}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </PageShell>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <Card className='gap-1 py-4'>
      <CardHeader className='px-4'>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className='px-4'>
        <div className='text-2xl font-bold tabular-nums'>{value}</div>
        {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
      </CardContent>
    </Card>
  )
}
