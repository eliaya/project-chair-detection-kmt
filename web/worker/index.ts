import { type z } from 'zod'
import {
  adminCreateSchema,
  adminUpdateSchema,
  cameraSchema,
  deviceSchema,
  idsSchema,
  loginSchema,
  occupancyPayloadSchema,
  setupSchema,
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
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES)
    throw new HttpError(413, 'Payload too large')
  const data = await req.json().catch(() => {
    throw new HttpError(400, 'Invalid JSON')
  })
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
      throw new HttpError(429, 'ログイン試行が多すぎます。1分後に再試行してください')
    const { email, password } = await body(req, loginSchema)
    const row = await env.DB.prepare(
      'SELECT id, email, name, password_hash FROM admins WHERE email = ?'
    )
      .bind(email)
      .first<Admin & { password_hash: string }>()
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH)
    if (!row || !ok)
      throw new HttpError(401, 'メールアドレスまたはパスワードが違います')
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
      throw new HttpError(
        403,
        'SETUP_TOKEN が未設定です。npx wrangler secret put SETUP_TOKEN で設定してください'
      )
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local'
    if (!(await env.LOGIN_LIMITER.limit({ key: `setup:${ip}` })).success)
      throw new HttpError(429, '試行が多すぎます。1分後に再試行してください')
    const d = await body(req, setupSchema)
    if (!(await secretEquals(d.setup_code, env.SETUP_TOKEN)))
      throw new HttpError(401, 'Setup code が違います')
    // Single statement, so two concurrent requests cannot both create an admin.
    const row = await env.DB.prepare(
      `INSERT INTO admins (email, name, password_hash)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)
       RETURNING id, email, name`
    )
      .bind(d.email, d.name, await hashPassword(d.password))
      .first<Admin>()
    if (!row)
      throw new HttpError(409, '初期設定は完了しています。ログインしてください')
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
      throw new HttpError(400, '自分自身は削除できません')
    return deleted(
      await env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(Number(id)).run()
    )
  }
  throw new HttpError(404, 'Not Found')
}

async function devices(req: Request, env: Env, id?: string, action?: string) {
  const cols = 'id, name, last_seen_at, created_at'
  if (!id && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT ${cols} FROM devices ORDER BY id`
    ).all()
    return json(results)
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
    return json({ ...row, token }, 201)
  }
  if (id && action === 'token' && req.method === 'POST') {
    const token = randomToken()
    const row = await env.DB.prepare(
      `UPDATE devices SET token_hash = ? WHERE id = ? RETURNING ${cols}`
    )
      .bind(await sha256(token), id)
      .first()
    if (!row) throw new HttpError(404, 'Not Found')
    return json({ ...row, token })
  }
  if (id && !action && req.method === 'PUT') {
    const d = await body(req, deviceSchema)
    const row = await env.DB.prepare(
      `UPDATE devices SET name = ? WHERE id = ? RETURNING ${cols}`
    )
      .bind(d.name, id)
      .first()
    if (!row) throw new HttpError(404, 'Not Found')
    return json(row)
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
  zones: { schema: zoneSchema, jsonCols: ['vertices', 'seats'] },
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
    return json(results.map(decode))
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
              "DELETE FROM seat_state WHERE seat_id GLOB ? || '_s[0-9]*'"
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

async function occupancy(req: Request, env: Env, url: URL, sub?: string) {
  if (sub === 'current' && req.method === 'GET') {
    const [seats, devs] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM seat_state ORDER BY seat_id'),
      env.DB.prepare('SELECT id, name, last_seen_at FROM devices ORDER BY id'),
    ])
    return json({
      now: new Date().toISOString(),
      seats: seats.results,
      devices: devs.results,
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
  const [cams, zones] = await env.DB.batch<Record<string, unknown>>([
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
      vertices: JSON.parse(z.vertices as string),
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
    env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(
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
        return json({ title: '参照先が存在しないか、他のデータから参照されています' }, 409)
      if (msg.includes('UNIQUE'))
        return json({ title: '同じIDまたはメールアドレスが既に存在します' }, 409)
      // Workers Logs collects console output.
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ msg: 'unhandled error', error: msg }))
      return json({ title: 'Internal Server Error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
