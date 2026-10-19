// Sample data for local dev, written to the local D1: a site name, a Pi with the camera and
// zones from ../config.json, and a random ~100-seat restaurant floor plan.
// Usage: npm run seed [-- --force]
// Skips when a device, camera, zone or floor plan already exists; --force overwrites the sample
// records (same ids) instead. A site name set in the setup wizard is always kept.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import {
  cameraSchema,
  deviceSchema,
  floorplanSchema,
  siteNameSchema,
  zoneSchema,
} from '../shared/schemas.ts'
import { sha256 } from '../worker/auth.ts'

const d1 = (...args: string[]) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'kmt-occupancy', '--local', '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  })

const [{ n }] = JSON.parse(
  d1('--command', `SELECT (SELECT count(*) FROM devices) + (SELECT count(*) FROM cameras)
    + (SELECT count(*) FROM zones) + (SELECT count(*) FROM settings WHERE key = 'floorplan') AS n`)
)[0].results
if (n && !process.argv.includes('--force')) {
  // eslint-disable-next-line no-console
  console.log('[seed] local data already exists; skipped (npm run seed -- --force to overwrite)')
  process.exit(0)
}

const sql = (v: unknown) => `'${String(v).replaceAll("'", "''")}'`
const statements: string[] = []

const site = siteNameSchema.parse({ site_name: 'サンプル店舗' })
statements.push(`INSERT INTO settings (key, value) VALUES ('site_name', ${sql(JSON.stringify(site.site_name))})
  ON CONFLICT (key) DO NOTHING;`)

// The token is thrown away: issue one with トークン再発行 on the device page when a Pi connects.
const device = deviceSchema.parse({ id: 'pi1', name: 'ホール Pi' })
statements.push(`INSERT INTO devices (id, name, token_hash)
  VALUES (${sql(device.id)}, ${sql(device.name)}, ${sql(await sha256(randomBytes(32).toString('base64url')))})
  ON CONFLICT (id) DO UPDATE SET name = excluded.name;`)

const cameras = config.cameras.map((c) =>
  cameraSchema.parse({
    id: c.id, device_id: device.id, device_path: c.device, fps: c.fps, width: c.resolution[0], height: c.resolution[1],
  })
)
for (const c of cameras)
  statements.push(`INSERT INTO cameras (id, device_id, device_path, fps, width, height)
  VALUES (${sql(c.id)}, ${sql(c.device_id)}, ${sql(c.device_path)}, ${c.fps}, ${c.width}, ${c.height})
  ON CONFLICT (id) DO UPDATE SET device_id = excluded.device_id, device_path = excluded.device_path,
    fps = excluded.fps, width = excluded.width, height = excluded.height;`)

const zones = config.zones.map((z) =>
  zoneSchema.parse({ id: z.id, camera_id: z.camera, description: z.description, seats: z.seats })
)
for (const z of zones)
  statements.push(`INSERT INTO zones (id, camera_id, description, seats)
  VALUES (${sql(z.id)}, ${sql(z.camera_id)}, ${sql(z.description)}, ${sql(JSON.stringify(z.seats))})
  ON CONFLICT (id) DO UPDATE SET camera_id = excluded.camera_id, description = excluded.description,
    seats = excluded.seats;`)

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

statements.push(`INSERT INTO settings (key, value) VALUES ('floorplan', ${sql(JSON.stringify(plan))})
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;`)

const dir = mkdtempSync(join(tmpdir(), 'kmt-seed-'))
try {
  const file = join(dir, 'seed.sql')
  writeFileSync(file, statements.join('\n'))
  d1('--file', file)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
const count = (k: Kind) => plan.items.filter((i) => i.model_url === `proc:${k}`).length
const seats = count('chair') + count('stool')
// eslint-disable-next-line no-console
console.log(`[seed] site name, device ${device.id}, ${cameras.length} camera(s), ${zones.length} zone(s) ` +
  `(${zones.reduce((a, z) => a + z.seats.flat().length, 0)} seats), and a ${W / 100} m × ${D / 100} m floor plan ` +
  `(${plan.items.length - seats} tables/counters, ${seats} seats)`)
