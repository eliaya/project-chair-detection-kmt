import { type z } from 'zod'
import {
  adminCreateSchema,
  adminUpdateSchema,
  cameraSchema,
  deviceSchema,
  floorplanSchema,
  idsSchema,
  loginSchema,
  occupancyPayloadSchema,
  type Health,
  setupSchema,
  siteNameSchema,
  thresholdsSchema,
  zoneSchema,
} from '../shared/schemas'
import {
  DUMMY_HASH,
  hashPassword,
  randomToken,
  secretEquals,
  sha256,
  signSession,
  verifyPassword,
  verifySession,
} from './auth'

const SESSION_TTL_S = 24 * 60 * 60
const MAX_BODY_BYTES = 1_000_000

type Admin = { id: number; email: string; name: string }

// Messages the admin UI shows are i18n keys (src/i18n), translated in the browser.
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Error bodies use { title } because src/lib/handle-server-error.ts shows it.
const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers })

const sessionCookie = (value: string, maxAge: number) =>
  `session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`

async function body<T extends z.ZodType>(
  req: Request,
  schema: T
): Promise<z.infer<T>> {
  const tooLarge = new HttpError(413, 'Payload too large')
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES)
    throw tooLarge
  // A chunked body has no Content-Length, so count bytes while reading.
  let size = 0
  const capped = req.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        size += chunk.byteLength
        if (size > MAX_BODY_BYTES) throw tooLarge
        c.enqueue(chunk)
      },
    })
  )
  const text = await new Response(capped).text().catch(() => {
    throw size > MAX_BODY_BYTES ? tooLarge : new HttpError(400, 'Invalid JSON')
  })
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
  const r = schema.safeParse(data)
  if (!r.success)
    throw new HttpError(
      400,
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    )
  return r.data
}

async function requireAdmin(req: Request, env: Env) {
  const token = req.headers.get('Cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
  const sub = token ? await verifySession(token, env.SESSION_SECRET) : null
  const admin = sub
    ? await env.DB.prepare('SELECT id, email, name FROM admins WHERE id = ?')
        .bind(sub)
        .first<Admin>()
    : null
  if (!admin) throw new HttpError(401, 'Unauthorized')
  return admin
}

async function requireDevice(req: Request, env: Env) {
  const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]
  const row = token
    ? await env.DB.prepare('SELECT id FROM devices WHERE token_hash = ?')
        .bind(await sha256(token))
        .first<{ id: string }>()
    : null
  if (!row) throw new HttpError(401, 'Invalid device token')
  return row.id
}

async function auth(req: Request, env: Env, action?: string) {
  if (action === 'login' && req.method === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local'
    if (!(await env.LOGIN_LIMITER.limit({ key: ip })).success)
      throw new HttpError(429, 'error.tooManyLogins')
    const { email, password } = await body(req, loginSchema)
    const row = await env.DB.prepare(
      'SELECT id, email, name, password_hash FROM admins WHERE email = ?'
    )
      .bind(email)
      .first<Admin & { password_hash: string }>()
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH)
    if (!row || !ok)
      throw new HttpError(401, 'error.badCredentials')
    const token = await signSession(row.id, env.SESSION_SECRET, SESSION_TTL_S)
    return json({ id: row.id, email: row.email, name: row.name }, 200, {
      'Set-Cookie': sessionCookie(token, SESSION_TTL_S),
    })
  }
  if (action === 'logout' && req.method === 'POST')
    return json({}, 200, { 'Set-Cookie': sessionCookie('', 0) })
  if (action === 'me' && req.method === 'GET')
    return json(await requireAdmin(req, env))
  throw new HttpError(404, 'Not Found')
}

// First-run setup: open only while no admin exists, and only with the SETUP_TOKEN secret.
async function setup(req: Request, env: Env) {
  if (req.method === 'GET') {
    const anyAdmin = await env.DB.prepare('SELECT 1 FROM admins LIMIT 1').first()
    return json({ needsAdmin: !anyAdmin, enabled: !!env.SETUP_TOKEN })
  }
  if (req.method === 'POST') {
    if (!env.SETUP_TOKEN)
      throw new HttpError(403, 'error.setupDisabled')
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local'
    if (!(await env.LOGIN_LIMITER.limit({ key: `setup:${ip}` })).success)
      throw new HttpError(429, 'error.tooManyAttempts')
    const d = await body(req, setupSchema)
    if (!(await secretEquals(d.setup_code, env.SETUP_TOKEN)))
      throw new HttpError(401, 'error.badSetupCode')
    // Single statement, so two concurrent requests cannot both create an admin.
    const row = await env.DB.prepare(
      `INSERT INTO admins (email, name, password_hash)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)
       RETURNING id, email, name`
    )
      .bind(d.email, d.name, await hashPassword(d.password))
      .first<Admin>()
    if (!row)
      throw new HttpError(409, 'error.setupDone')
    // Only the request that created the admin gets here, so a losing race cannot rename the site.
    await saveSiteName(env, d.site_name)
    const token = await signSession(row.id, env.SESSION_SECRET, SESSION_TTL_S)
    return json(row, 201, { 'Set-Cookie': sessionCookie(token, SESSION_TTL_S) })
  }
  throw new HttpError(404, 'Not Found')
}

async function admins(req: Request, env: Env, me: Admin, id?: string) {
  const cols = 'id, email, name, created_at'
  if (!id && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT ${cols} FROM admins ORDER BY id`
    ).all()
    return json(results)
  }
  if (!id && req.method === 'POST') {
    const d = await body(req, adminCreateSchema)
    const row = await env.DB.prepare(
      `INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?) RETURNING ${cols}`
    )
      .bind(d.email, d.name, await hashPassword(d.password))
      .first()
    return json(row, 201)
  }
  if (id && req.method === 'PUT') {
    const d = await body(req, adminUpdateSchema)
    const hash = d.password ? await hashPassword(d.password) : null
    const row = await env.DB.prepare(
      `UPDATE admins SET email = ?, name = ?, password_hash = COALESCE(?, password_hash)
       WHERE id = ? RETURNING ${cols}`
    )
      .bind(d.email, d.name, hash, Number(id))
      .first()
    if (!row) throw new HttpError(404, 'Not Found')
    return json(row)
  }
  if (id && req.method === 'DELETE') {
    if (Number(id) === me.id)
      throw new HttpError(400, 'error.cannotDeleteSelf')
    return deleted(
      await env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(Number(id)).run()
    )
  }
  throw new HttpError(404, 'Not Found')
}

// Research plan: a Pi silent for 90 s is offline and its seats are unknown.
const OFFLINE_MS = 90_000

type DeviceRow = {
  id: string
  last_seen_at: string | null
  config_fetched_at: string | null
  health: string | Health | null
}

// Judged on the Worker clock, so a skewed browser or Pi clock does not matter.
function deviceStatus(d: DeviceRow, now: number) {
  const recent = (t: string | null) => !!t && now - Date.parse(t) <= OFFLINE_MS
  if (!d.last_seen_at && !d.config_fetched_at) return 'not_connected'
  if (!recent(d.last_seen_at))
    // Fetched its config, no heartbeat yet: main.py is starting.
    return recent(d.config_fetched_at) &&
      (!d.last_seen_at || d.config_fetched_at! > d.last_seen_at)
      ? 'starting'
      : 'offline'
  const cams = (d.health as Health | null)?.cameras ?? {}
  return Object.values(cams).some((s) => s !== 'ok') ? 'camera_error' : 'online'
}

function cameraStatus(cameraId: string, d: DeviceRow | undefined, now: number) {
  const s = d ? deviceStatus(d, now) : 'not_connected'
  if (s !== 'online' && s !== 'camera_error') return 'offline'
  // A camera added after main.py started is reported after a restart.
  return (d!.health as Health | null)?.cameras?.[cameraId] ?? 'not_reported'
}

const withStatus = (row: Record<string, unknown>, now = Date.now()) => {
  const d = row as DeviceRow
  const health = typeof d.health === 'string' ? JSON.parse(d.health) : d.health
  return { ...row, health, status: deviceStatus({ ...d, health }, now) }
}

async function devicesById(env: Env) {
  const { results } = await env.DB.prepare(
    'SELECT id, last_seen_at, config_fetched_at, health FROM devices'
  ).all<DeviceRow>()
  return new Map(
    results.map((d) => [d.id, withStatus(d) as unknown as DeviceRow])
  )
}

async function devices(req: Request, env: Env, id?: string, action?: string) {
  const cols = 'id, name, last_seen_at, config_fetched_at, health, created_at'
  if (!id && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT ${cols} FROM devices ORDER BY id`
    ).all()
    return json(results.map((r) => withStatus(r)))
  }
  if (!id && req.method === 'POST') {
    const d = await body(req, deviceSchema)
    const token = randomToken()
    const row = await env.DB.prepare(
      `INSERT INTO devices (id, name, token_hash) VALUES (?, ?, ?) RETURNING ${cols}`
    )
      .bind(d.id, d.name, await sha256(token))
      .first()
    // The plain token is returned only here and on rotation.
    return json({ ...withStatus(row!), token }, 201)
  }
  if (id && action === 'token' && req.method === 'POST') {
    const token = randomToken()
    const row = await env.DB.prepare(
      `UPDATE devices SET token_hash = ? WHERE id = ? RETURNING ${cols}`
    )
      .bind(await sha256(token), id)
      .first()
    if (!row) throw new HttpError(404, 'Not Found')
    return json({ ...withStatus(row), token })
  }
  if (id && !action && req.method === 'PUT') {
    const d = await body(req, deviceSchema)
    const row = await env.DB.prepare(
      `UPDATE devices SET name = ? WHERE id = ? RETURNING ${cols}`
    )
      .bind(d.name, id)
      .first()
    if (!row) throw new HttpError(404, 'Not Found')
    return json(withStatus(row))
  }
  if (id && !action && req.method === 'DELETE')
    return deleted(
      await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id).run()
    )
  throw new HttpError(404, 'Not Found')
}

// Plain config tables; ids are immutable after creation (seat ids derive from zone ids).
const configTables = {
  cameras: { schema: cameraSchema, jsonCols: [] as string[] },
  zones: { schema: zoneSchema, jsonCols: ['seats'] },
}

async function crud(
  req: Request,
  env: Env,
  table: keyof typeof configTables,
  id?: string
) {
  const { schema, jsonCols } = configTables[table]
  const cols = Object.keys(schema.shape)
  const decode = (row: Record<string, unknown>) => {
    for (const c of jsonCols) row[c] = JSON.parse(row[c] as string)
    return row
  }
  const values = (d: Record<string, unknown>, keys: string[]) =>
    keys.map((c) => (jsonCols.includes(c) ? JSON.stringify(d[c]) : d[c]))

  if (!id && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM ${table} ORDER BY id`
    ).all()
    const rows = results.map(decode)
    if (table !== 'cameras') return json(rows)
    const devs = await devicesById(env)
    const now = Date.now()
    return json(
      rows.map((c) => ({
        ...c,
        status: cameraStatus(c.id as string, devs.get(c.device_id as string), now),
      }))
    )
  }
  if (!id && req.method === 'POST') {
    const d = await body(req, schema)
    await env.DB.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
      .bind(...values(d, cols))
      .run()
    return json(d, 201)
  }
  if (id && req.method === 'PUT') {
    const d = { ...(await body(req, schema)), id }
    const keys = cols.filter((c) => c !== 'id')
    const r = await env.DB.prepare(
      `UPDATE ${table} SET ${keys.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
    )
      .bind(...values(d, keys), id)
      .run()
    if (!r.meta.changes) throw new HttpError(404, 'Not Found')
    return json(d)
  }
  if (id && req.method === 'DELETE') {
    const [r] = await env.DB.batch([
      env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id),
      // A re-created zone with the same id must not inherit old seat states.
      // ids are [A-Za-z0-9_-], so they contain no GLOB metacharacters.
      ...(table === 'zones'
        ? [
            env.DB.prepare(
              "DELETE FROM seat_state WHERE seat_id GLOB ? || '_t[0-9][0-9]_s[0-9][0-9]'"
            ).bind(id),
          ]
        : []),
    ])
    return deleted(r)
  }
  throw new HttpError(404, 'Not Found')
}

function deleted(r: D1Result) {
  if (!r.meta.changes) throw new HttpError(404, 'Not Found')
  return new Response(null, { status: 204 })
}

async function thresholds(req: Request, env: Env) {
  if (req.method === 'GET') {
    const v = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'thresholds'"
    ).first<string>('value')
    return json(JSON.parse(v ?? '{}'))
  }
  if (req.method === 'PUT') {
    const d = await body(req, thresholdsSchema)
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('thresholds', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
    )
      .bind(JSON.stringify(d))
      .run()
    return json(d)
  }
  throw new HttpError(404, 'Not Found')
}

const saveSiteName = (env: Env, siteName: string) =>
  env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('site_name', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
  )
    .bind(JSON.stringify(siteName))
    .run()

async function siteName(req: Request, env: Env) {
  if (req.method === 'GET') {
    const v = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'site_name'"
    ).first<string>('value')
    return json({ site_name: v ? JSON.parse(v) : null })
  }
  if (req.method === 'PUT') {
    const d = await body(req, siteNameSchema)
    await saveSiteName(env, d.site_name)
    return json(d)
  }
  throw new HttpError(404, 'Not Found')
}

async function floorplan(req: Request, env: Env) {
  if (req.method === 'GET') {
    const v = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'floorplan'"
    ).first<string>('value')
    return json(v ? JSON.parse(v) : null)
  }
  if (req.method === 'PUT') {
    const d = await body(req, floorplanSchema)
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('floorplan', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
    )
      .bind(JSON.stringify(d))
      .run()
    return json(d)
  }
  throw new HttpError(404, 'Not Found')
}

async function occupancy(req: Request, env: Env, url: URL, sub?: string) {
  if (sub === 'current' && req.method === 'GET') {
    const [seats, cams] = await env.DB.batch<Record<string, string>>([
      env.DB.prepare('SELECT * FROM seat_state ORDER BY seat_id'),
      env.DB.prepare('SELECT id, device_id FROM cameras ORDER BY id'),
    ])
    const devs = await devicesById(env)
    const now = Date.now()
    return json({
      now: new Date(now).toISOString(),
      seats: seats.results,
      // Seats are only trusted while their camera reports "ok".
      cameras: cams.results.map((c) => ({
        id: c.id,
        status: cameraStatus(c.id, devs.get(c.device_id), now),
      })),
    })
  }
  if (sub === 'events' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 500, 1), 1000)
    const { results } = await env.DB.prepare(
      'SELECT * FROM occupancy_events ORDER BY id DESC LIMIT ?'
    )
      .bind(limit)
      .all()
    return json(results)
  }
  if (sub === 'events' && req.method === 'DELETE') {
    const { ids } = await body(req, idsSchema)
    const r = await env.DB.prepare(
      'DELETE FROM occupancy_events WHERE id IN (SELECT value FROM json_each(?))'
    )
      .bind(JSON.stringify(ids))
      .run()
    return json({ deleted: r.meta.changes })
  }
  throw new HttpError(404, 'Not Found')
}

// GET /api/config: same shape as config.json, limited to the calling device.
async function deviceConfig(env: Env, deviceId: string, origin: string) {
  const [, cams, zones] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare('UPDATE devices SET config_fetched_at = ? WHERE id = ?').bind(
      new Date().toISOString(),
      deviceId
    ),
    env.DB.prepare('SELECT * FROM cameras WHERE device_id = ? ORDER BY id').bind(deviceId),
    env.DB.prepare(
      'SELECT z.* FROM zones z JOIN cameras c ON c.id = z.camera_id WHERE c.device_id = ? ORDER BY z.id'
    ).bind(deviceId),
  ])
  const th = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'thresholds'"
  ).first<string>('value')
  return json({
    cameras: cams.results.map((c) => ({
      id: c.id,
      device: c.device_path,
      fps: c.fps,
      resolution: [c.width, c.height],
    })),
    zones: zones.results.map((z) => ({
      id: z.id,
      camera: z.camera_id,
      description: z.description,
      seats: JSON.parse(z.seats as string),
    })),
    thresholds: JSON.parse(th ?? '{}'),
    // The token stays on the device (API_TOKEN env); it is never echoed back.
    cloud: { api_url: `${origin}/api/occupancy` },
  })
}

// POST /api/occupancy from main.py: only status changes are written.
async function ingest(req: Request, env: Env, deviceId: string) {
  const p = await body(req, occupancyPayloadSchema)
  const now = Date.now()
  const t = Date.parse(p.timestamp ?? '')
  // Normalized ISO-Z so string comparison orders correctly; future clocks are clamped.
  const ts = new Date(Number.isNaN(t) ? now : Math.min(t, now)).toISOString()
  const ids = Object.keys(p.occupancy)
  const { results } = await env.DB.prepare(
    'SELECT seat_id, status FROM seat_state WHERE seat_id IN (SELECT value FROM json_each(?))'
  )
    .bind(JSON.stringify(ids))
    .all<{ seat_id: string; status: string }>()
  const current = new Map(results.map((r) => [r.seat_id, r.status]))
  const changed = ids.filter((id) => current.get(id) !== p.occupancy[id].status)

  const stmts = [
    p.health
      ? env.DB.prepare(
          'UPDATE devices SET last_seen_at = ?, health = ? WHERE id = ?'
        ).bind(new Date(now).toISOString(), JSON.stringify(p.health), deviceId)
      : env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(
          new Date(now).toISOString(),
          deviceId
        ),
  ]
  for (const id of changed) {
    const status = p.occupancy[id].status
    stmts.push(
      // A late (queued offline) payload must not overwrite a newer state.
      env.DB.prepare(
        `INSERT INTO seat_state (seat_id, device_id, status, since) VALUES (?, ?, ?, ?)
         ON CONFLICT (seat_id) DO UPDATE SET device_id = excluded.device_id,
           status = excluded.status, since = excluded.since
         WHERE excluded.since >= seat_state.since`
      ).bind(id, deviceId, status, ts),
      env.DB.prepare(
        'INSERT INTO occupancy_events (seat_id, device_id, status, ts) VALUES (?, ?, ?, ?)'
      ).bind(id, deviceId, status, ts)
    )
  }
  await env.DB.batch(stmts)
  return json({ changed: changed.length })
}

async function route(req: Request, env: Env) {
  const url = new URL(req.url)
  const [, , res, id, action] = url.pathname
    .split('/')
    .map(decodeURIComponent) as (string | undefined)[]

  if (res === 'config' && !id && req.method === 'GET')
    return deviceConfig(env, await requireDevice(req, env), url.origin)
  if (res === 'occupancy' && !id && req.method === 'POST')
    return ingest(req, env, await requireDevice(req, env))
  if (res === 'auth') return auth(req, env, id)
  if (res === 'setup' && !id) return setup(req, env)

  const me = await requireAdmin(req, env)
  if (res === 'admins' && !action) return admins(req, env, me, id)
  if (res === 'devices') return devices(req, env, id, action)
  if ((res === 'cameras' || res === 'zones') && !action)
    return crud(req, env, res, id)
  if (res === 'settings' && id === 'thresholds' && !action)
    return thresholds(req, env)
  if (res === 'settings' && id === 'site_name' && !action)
    return siteName(req, env)
  if (res === 'settings' && id === 'floorplan' && !action)
    return floorplan(req, env)
  if (res === 'occupancy' && !action) return occupancy(req, env, url, id)
  throw new HttpError(404, 'Not Found')
}

export default {
  async fetch(req, env) {
    try {
      if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
      return await route(req, env)
    } catch (e) {
      if (e instanceof HttpError) return json({ title: e.message }, e.status)
      const msg = String(e)
      if (msg.includes('FOREIGN KEY'))
        return json({ title: 'error.fkConflict' }, 409)
      if (msg.includes('UNIQUE'))
        return json({ title: 'error.duplicate' }, 409)
      // Workers Logs collects console output.
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ msg: 'unhandled error', error: msg }))
      return json({ title: 'Internal Server Error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
