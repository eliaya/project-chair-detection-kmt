import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { FloorplanMap, type MapPlan } from '@/components/floorplan-map'
import { type PublicSeat } from '../../../shared/occupancy'

// Mounted only while its tab is open; the plan changes rarely.
export function FloorplanTab({
  states,
  zones,
}: {
  states: PublicSeat['state'][]
  zones: { id: string; empty_seats: number }[]
}) {
  const { t } = useI18n()
  const { data } = useQuery({
    queryKey: ['public', 'floorplan'],
    queryFn: async () => {
      const r = await fetch('/api/public/floorplan')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as MapPlan | null
    },
    refetchInterval: 60_000,
  })
  if (data === undefined) return null
  if (data === null)
    return (
      <p className='p-8 text-muted-foreground'>{t('portal.noFloorplan')}</p>
    )
  const empty = new Map(zones.map((z) => [z.id, z.empty_seats]))
  return (
    <FloorplanMap
      plan={data}
      states={states}
      // Natural aspect ratio when stacked; fills the panel beside the counts.
      className='h-auto w-full lg:h-full'
      zoneLabel={(zone) =>
        t('portal.zoneLabel', { zone, n: empty.get(zone) ?? 0 })
      }
    />
  )
}
