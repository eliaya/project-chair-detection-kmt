// Writes a random ~100-seat restaurant floor plan into the local D1, for trying the floor plan page.
// Usage: npm run seed:floorplan [-- --force]   (--force replaces a plan that is already saved)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { floorplanSchema } from '../shared/schemas.ts'

const d1 = (...args: string[]) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'kmt-occupancy', '--local', '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  })

const saved = JSON.parse(d1('--command', "SELECT 1 FROM settings WHERE key = 'floorplan'"))[0].results
if (saved.length && !process.argv.includes('--force')) {
  // eslint-disable-next-line no-console
  console.error('A floor plan is already saved; run with --force to replace it.')
  process.exit(1)
}

// Half heights (cm) of the shapes in src/features/floorplan/furniture.ts, so items stand on the floor.
const halfHeight = { table2: 36, table4: 36, table6: 36, round: 36, counter: 52.5, chair: 44, stool: 37.5 }
const names = { table2: '2人卓', table4: '4人卓', table6: '6人卓', round: '丸テーブル', counter: 'カウンター', chair: '椅子', stool: 'スツール' }
type Kind = keyof typeof halfHeight

const items: unknown[] = []
const put = (kind: Kind, x: number, z: number, rotation = 0) =>
  items.push({
    item_name: names[kind], item_type: 1, model_url: `proc:${kind}`,
    xpos: x, ypos: halfHeight[kind], zpos: z, rotation,
    scale_x: 1, scale_y: 1, scale_z: 1, fixed: false,
  })
const rand = (min: number, max: number) => min + Math.random() * (max - min)

// Chairs as offsets from the table centre; each faces the table (its back points away).
const chairs: Record<string, [number, number][]> = {
  table2: [[0, 62], [0, -62]],
  table4: [[-30, 62], [30, 62], [-30, -62], [30, -62]],
  table6: [[-55, 65], [0, 65], [55, 65], [-55, -65], [0, -65], [55, -65]],
  round: [[0, 70], [70, 0], [0, -70], [-70, 0]],
}
function tableWithChairs(kind: keyof typeof chairs, x: number, z: number, angle: number) {
  put(kind as Kind, x, z, angle)
  for (const [ox, oz] of chairs[kind]) {
    // three.js rotation about y: x' = x cos + z sin, z' = -x sin + z cos.
    const wx = ox * Math.cos(angle) + oz * Math.sin(angle)
    const wz = -ox * Math.sin(angle) + oz * Math.cos(angle)
    put('chair', x + wx, z + wz, Math.atan2(-ox, -oz) + angle)
  }
}

// 20 m × 12 m room. Counter with stools along the top wall; tables in a jittered grid below.
const W = 2000
const D = 1200
for (let i = 0; i < 4; i++) {
  const cx = 420 + i * 240
  put('counter', cx, 50)
  for (const sx of [-90, -30, 30, 90]) put('stool', cx + sx, 115)
}
const kinds = ['table2', 'table2', 'table4', 'table4', 'table4', 'table6', 'round'] as const
for (let row = 0; row < 3; row++)
  for (let col = 0; col < 6; col++) {
    const kind = kinds[Math.floor(Math.random() * kinds.length)]
    const angle = (Math.random() < 0.5 ? 0 : Math.PI / 2) + rand(-0.25, 0.25)
    tableWithChairs(kind, 230 + col * 310 + rand(-25, 25), 380 + row * 290 + rand(-25, 25), angle)
  }

const plan = floorplanSchema.parse({
  floorplan: {
    corners: { c1: { x: 0, y: D }, c2: { x: W, y: D }, c3: { x: W, y: 0 }, c4: { x: 0, y: 0 } },
    walls: [
      { corner1: 'c4', corner2: 'c1' },
      { corner1: 'c1', corner2: 'c2' },
      { corner1: 'c2', corner2: 'c3' },
      { corner1: 'c3', corner2: 'c4' },
    ],
  },
  items,
})

const dir = mkdtempSync(join(tmpdir(), 'kmt-seed-'))
try {
  const file = join(dir, 'seed.sql')
  const json = JSON.stringify(plan).replaceAll("'", "''")
  writeFileSync(file,
    `INSERT INTO settings (key, value) VALUES ('floorplan', '${json}') ON CONFLICT (key) DO UPDATE SET value = excluded.value;`)
  d1('--file', file)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
const count = (k: Kind) => plan.items.filter((i) => i.model_url === `proc:${k}`).length
const seats = count('chair') + count('stool')
// eslint-disable-next-line no-console
console.log(`Saved a ${W / 100} m × ${D / 100} m plan: ${plan.items.length - seats} tables/counters, ${seats} seats.`)
// eslint-disable-next-line no-console
console.log('Reload the floor plan page (設定 → 平面図) to see it.')
