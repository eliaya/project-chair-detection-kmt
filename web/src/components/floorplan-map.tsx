import { cn } from '@/lib/utils'
import { type PublicSeat } from '../../shared/occupancy'

// Top-view footprints (cm) of the shapes in features/floorplan/furniture.ts.
const footprints: Record<string, { w: number; d: number; round?: boolean }> = {
  table2: { w: 75, d: 75 },
  table4: { w: 120, d: 75 },
  table6: { w: 180, d: 80 },
  round: { w: 90, d: 90, round: true },
  counter: { w: 240, d: 55 },
  chair: { w: 42, d: 42 },
  stool: { w: 34, d: 34, round: true },
}

export type MapPlan = {
  floorplan: {
    corners: Record<string, { x: number; y: number }>
    walls: { corner1: string; corner2: string }[]
  }
  items: {
    model_url: string
    xpos: number
    zpos: number
    rotation: number
    scale_x: number
    scale_z: number
    zone?: string
  }[]
}

const fills: Record<PublicSeat['state'], string> = {
  empty: 'fill-emerald-500',
  used: 'fill-red-500',
  unknown: 'fill-muted-foreground/30',
}

type Box = { x0: number; z0: number; x1: number; z1: number }
const grow = (b: Box, o: Box) => {
  b.x0 = Math.min(b.x0, o.x0)
  b.z0 = Math.min(b.z0, o.z0)
  b.x1 = Math.max(b.x1, o.x1)
  b.z1 = Math.max(b.z1, o.z1)
}

/**
 * 2D top view of a blueprint3d plan: walls, furniture coloured by state, and a
 * frame around each zone's bound furniture. Fits its container (SVG viewBox).
 */
export function FloorplanMap({
  plan,
  states,
  zoneLabel,
  className = 'size-full',
}: {
  plan: MapPlan
  states: PublicSeat['state'][]
  zoneLabel: (zone: string) => string
  className?: string
}) {
  const corners = plan.floorplan.corners
  const items = plan.items.map((item, i) => {
    const f = footprints[item.model_url.slice(5)] ?? footprints.table4
    const w = f.w * item.scale_x
    const d = f.d * item.scale_z
    const cos = Math.abs(Math.cos(item.rotation))
    const sin = Math.abs(Math.sin(item.rotation))
    const hx = (w * cos + d * sin) / 2
    const hz = (w * sin + d * cos) / 2
    const { xpos: x, zpos: z } = item
    return {
      ...item,
      ...f,
      w,
      d,
      state: states.length === plan.items.length ? states[i] : 'unknown',
      box: { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz },
    }
  })

  const frames = new Map<string, Box>()
  for (const item of items) {
    if (!item.zone) continue
    const b = frames.get(item.zone)
    if (b) grow(b, item.box)
    else frames.set(item.zone, { ...item.box })
  }

  const bounds: Box = {
    x0: Infinity,
    z0: Infinity,
    x1: -Infinity,
    z1: -Infinity,
  }
  for (const c of Object.values(corners))
    grow(bounds, { x0: c.x, z0: c.y, x1: c.x, z1: c.y })
  for (const item of items) grow(bounds, item.box)
  if (!Number.isFinite(bounds.x0)) return null
  const size = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0, 100)
  const pad = size * 0.02
  const font = size / 40
  for (const b of frames.values()) {
    b.x0 -= pad
    b.z0 -= pad
    b.x1 += pad
    b.z1 += pad
    // Room for the label above the frame.
    grow(bounds, { ...b, z0: b.z0 - font * 1.4 })
  }
  const vx = bounds.x0 - pad
  const vz = bounds.z0 - pad

  return (
    <svg
      viewBox={`${vx} ${vz} ${bounds.x1 + pad - vx} ${bounds.z1 + pad - vz}`}
      className={className}
    >
      {plan.floorplan.walls.map((wall, i) => {
        const a = corners[wall.corner1]
        const b = corners[wall.corner2]
        if (!a || !b) return null
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className='stroke-foreground/60'
            strokeWidth={10}
            strokeLinecap='round'
          />
        )
      })}
      {[...frames].map(([zone, b]) => (
        <g key={zone}>
          <rect
            x={b.x0}
            y={b.z0}
            width={b.x1 - b.x0}
            height={b.z1 - b.z0}
            rx={pad}
            className='fill-primary/5 stroke-primary/50'
            strokeWidth={size / 400}
            strokeDasharray={`${size / 80} ${size / 160}`}
          />
          <text
            x={b.x0}
            y={b.z0 - font * 0.4}
            fontSize={font}
            className='fill-foreground stroke-background font-semibold'
            strokeWidth={font / 6}
            paintOrder='stroke'
          >
            {zoneLabel(zone)}
          </text>
        </g>
      ))}
      {items.map((item, i) => (
        // blueprint3d turns items about +y; seen from above with z down, that is a negative SVG angle.
        <g
          key={i}
          transform={`translate(${item.xpos} ${item.zpos}) rotate(${(-item.rotation * 180) / Math.PI})`}
          className={cn(fills[item.state], 'stroke-background')}
          strokeWidth={2}
        >
          {item.round ? (
            <ellipse rx={item.w / 2} ry={item.d / 2} />
          ) : (
            <rect
              x={-item.w / 2}
              y={-item.d / 2}
              width={item.w}
              height={item.d}
              rx={4}
            />
          )}
          {item.model_url === 'proc:chair' && (
            // Backrest, on the chair's -z side.
            <rect
              x={-item.w / 2}
              y={-item.d / 2}
              width={item.w}
              height={item.d / 5}
              className='fill-foreground/40'
            />
          )}
        </g>
      ))}
    </svg>
  )
}
