import { type z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, listQuery } from '@/lib/api'
import { type TableStatus, seatStatusLabel } from '@/lib/seat-status'
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
  devices: { id: string; last_seen_at: string | null }[]
}

// Research plan: seats of a device silent for 90 s are shown as unknown.
const OFFLINE_MS = 90_000

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

const elapsed = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`
}

export function Dashboard() {
  const zones = useQuery(listQuery<Zone>('zones'))
  const current = useQuery({
    queryKey: ['occupancy', 'current'],
    queryFn: () => api.get<Current>('/occupancy/current').then((r) => r.data),
    refetchInterval: 5000,
  })

  // Server time, so a skewed browser clock does not mark devices offline.
  const now = current.data ? Date.parse(current.data.now) : 0
  const seats = new Map(current.data?.seats.map((s) => [s.seat_id, s]))
  const lastSeen = new Map(
    current.data?.devices.map((d) => [d.id, d.last_seen_at])
  )
  // main.py reports table i of a zone as "<zone id>_s<ii>".
  const zoneTables = (zones.data ?? []).map((zone) => ({
    zone,
    tables: zone.seats.map((names, i) => {
      const s = seats.get(`${zone.id}_s${String(i).padStart(2, '0')}`)
      const seen = s && lastSeen.get(s.device_id)
      const status: TableStatus =
        s && seen && now - Date.parse(seen) <= OFFLINE_MS ? s.status : 'unknown'
      return { names, status, since: s?.since }
    }),
  }))
  const all = zoneTables.flatMap((z) => z.tables)
  const inUse = all.filter(
    (t) => t.status === 'occupied' || t.status === 'leave_confirm'
  ).length
  const unknown = all.filter((t) => t.status === 'unknown').length
  const known = all.length - unknown

  return (
    <PageShell
      title='ダッシュボード'
      description='卓ごとの稼働状況（5秒ごとに更新）'
    >
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Stat label='卓数' value={all.length} />
        <Stat label='利用中' value={inUse} />
        <Stat
          label='稼働率'
          value={known ? `${Math.round((inUse / known) * 100)}%` : '—'}
          hint='不明の卓を除く'
        />
        <Stat
          label='不明'
          value={unknown}
          hint='未受信、または90秒以上通信なし'
        />
      </div>

      {zones.data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>初期設定を完了しましょう</CardTitle>
            <CardDescription>
              デバイス・カメラ・ゾーンを登録すると、卓の稼働状況がここに表示されます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to='/devices'>デバイスを登録</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {zoneTables.map(({ zone, tables }) => (
        <Card key={zone.id}>
          <CardHeader>
            <CardTitle>{zone.id}</CardTitle>
            <CardDescription>{zone.description}</CardDescription>
          </CardHeader>
          <CardContent className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
            {tables.map((t, i) => (
              <div
                key={i}
                className={cn('rounded-lg border p-3', statusClass[t.status])}
              >
                <div className='truncate text-sm'>{t.names.join('・')}</div>
                <div className='mt-1 flex items-baseline justify-between gap-2'>
                  <span className='font-semibold'>
                    {seatStatusLabel[t.status]}
                  </span>
                  {t.since && t.status !== 'unknown' && (
                    <span className='text-xs tabular-nums'>
                      {elapsed(now - Date.parse(t.since))}
                    </span>
                  )}
                </div>
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
