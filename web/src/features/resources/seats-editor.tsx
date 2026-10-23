import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { Check, Plus, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  addSeat,
  parseTables,
  type Point,
  removeLastSeat,
} from './seat-drawing'

const MAX_POINTS = 32 // the schema's limit per seat
const colors = ['#22c55e', '#3b82f6', '#f97316', '#d946ef', '#06b6d4']

type Snapshot = { url: string; width: number; height: number }

// Seat polygons clicked on a camera snapshot, written into the seats JSON text.
// The snapshot stays in the browser; only the polygons (image pixels) are saved.
export function SeatsEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (text: string) => void
}) {
  const { t } = useI18n()
  const [image, setImage] = useState<Snapshot>()
  const [points, setPoints] = useState<Point[]>([])
  const [newTable, setNewTable] = useState(false)
  const [prefix, setPrefix] = useState('A')
  const tables = parseTables(value)

  useEffect(() => () => image && URL.revokeObjectURL(image.url), [image])

  const pick = (file?: File) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () =>
      setImage({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.src = url
  }

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const m = e.currentTarget.getScreenCTM()
    if (!m || !image || !tables || points.length >= MAX_POINTS) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    const clamp = (v: number, max: number) =>
      Math.min(max, Math.max(0, Math.round(v)))
    setPoints([...points, [clamp(p.x, image.width), clamp(p.y, image.height)]])
  }

  const closeSeat = () => {
    if (!tables || points.length < 3) return
    onChange(JSON.stringify(addSeat(tables, points, prefix, newTable)))
    setPoints([])
    setNewTable(false)
  }
  const nextTable = () => {
    closeSeat()
    setNewTable(true)
  }
  const undo = () => {
    if (points.length) setPoints(points.slice(0, -1))
    else if (newTable) setNewTable(false)
    else if (tables?.length) onChange(JSON.stringify(removeLastSeat(tables)))
  }

  const size = image ? Math.max(image.width, image.height) : 1
  const tableNo = (tables?.length ?? 0) + (newTable || !tables?.length ? 1 : 0)

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-end gap-2'>
        <div className='grid gap-1'>
          <Label htmlFor='seats-snapshot'>{t('zones.snapshot')}</Label>
          <Input
            id='seats-snapshot'
            type='file'
            accept='image/*'
            className='max-w-64'
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
        <div className='grid gap-1'>
          <Label htmlFor='seats-prefix'>{t('zones.prefix')}</Label>
          <Input
            id='seats-prefix'
            className='w-20'
            maxLength={8}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </div>
      </div>
      {image && (
        <>
          <svg
            viewBox={`0 0 ${image.width} ${image.height}`}
            className='w-full cursor-crosshair rounded-md border'
            role='img'
            aria-label={t('zones.snapshot')}
            onClick={click}
          >
            <image href={image.url} width={image.width} height={image.height} />
            {tables?.map((table, ti) =>
              table.map((seat) => {
                const c = colors[ti % colors.length]
                const n = seat.vertices.length || 1
                const cx = seat.vertices.reduce((a, p) => a + p[0], 0) / n
                const cy = seat.vertices.reduce((a, p) => a + p[1], 0) / n
                return (
                  <g key={`${ti}-${seat.name}`}>
                    <polygon
                      points={seat.vertices.join(' ')}
                      fill={c}
                      fillOpacity={0.2}
                      stroke={c}
                      strokeWidth={2}
                      vectorEffect='non-scaling-stroke'
                    />
                    <text
                      x={cx}
                      y={cy}
                      textAnchor='middle'
                      dominantBaseline='middle'
                      fontSize={size / 50}
                      fill='#fff'
                      stroke='#000'
                      strokeWidth={size / 400}
                      paintOrder='stroke'
                    >
                      {seat.name}
                    </text>
                  </g>
                )
              })
            )}
            {points.length > 0 && (
              <polyline
                points={points.join(' ')}
                fill='none'
                stroke='#facc15'
                strokeWidth={2}
                vectorEffect='non-scaling-stroke'
              />
            )}
            {points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={size / 250} fill='#facc15' />
            ))}
          </svg>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              size='sm'
              onClick={closeSeat}
              disabled={!tables || points.length < 3}
            >
              <Check /> {t('zones.closeSeat')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={nextTable}
              disabled={!tables}
            >
              <Plus /> {t('zones.nextTable')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={undo}
              disabled={!tables}
            >
              <Undo2 /> {t('zones.undo')}
            </Button>
            <span className='text-xs text-muted-foreground'>
              {tables
                ? t('zones.drawing', { table: tableNo, points: points.length })
                : t('validation.json')}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
