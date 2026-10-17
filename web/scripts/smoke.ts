// End-to-end API check against a running Worker (npm run dev, or a deployed URL).
// Usage: SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke -- http://localhost:5173
// Creates and removes smoke-* records. Logs in twice (login is rate limited to 5/min).
import assert from 'node:assert/strict'

const base = process.argv[2] ?? 'http://localhost:5173'
const { SMOKE_EMAIL: email, SMOKE_PASSWORD: password } = process.env
assert.ok(email && password, 'set SMOKE_EMAIL and SMOKE_PASSWORD')

let cookie = ''
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie && { Cookie: cookie }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null }
}
// eslint-disable-next-line no-console
const step = (msg: string) => console.log(`✔ ${msg}`)

assert.equal((await call('GET', '/api/auth/me')).status, 401)
assert.equal((await call('GET', '/api/zones')).status, 401)
step('unauthenticated requests are rejected')

assert.equal((await call('POST', '/api/auth/login', { email, password: 'wrong-password' })).status, 401)
assert.equal((await call('POST', '/api/auth/login', { email, password })).status, 200)
const me = (await call('GET', '/api/auth/me')).data
assert.equal(me.email, email.toLowerCase())
step('login, wrong password rejected')

const dev = await call('POST', '/api/devices', { id: 'smoke-pi', name: 'Smoke' })
assert.equal(dev.status, 201)
assert.ok(dev.data.token.length > 30 && !('token_hash' in dev.data))
const cam = { id: 'smoke-cam', device_id: 'smoke-pi', device_path: '/dev/video0', fps: 1, width: 1920, height: 1080 }
assert.equal((await call('POST', '/api/cameras', cam)).status, 201)
assert.equal((await call('POST', '/api/cameras', cam)).status, 409)
assert.equal((await call('POST', '/api/cameras', { ...cam, id: 'smoke-cam2', device_id: 'nope' })).status, 409)
assert.equal((await call('POST', '/api/cameras', { ...cam, device_path: 'video0' })).status, 400)
const zone = { id: 'smoke-zone', camera_id: 'smoke-cam', description: 'x', vertices: [[0, 0], [100, 0], [100, 100]], seats: [['S1', 'S2'], ['S3']] }
assert.equal((await call('POST', '/api/zones', zone)).status, 201)
assert.equal((await call('PUT', '/api/zones/smoke-zone', { ...zone, description: 'edited' })).status, 200)
const zones = (await call('GET', '/api/zones')).data
assert.deepEqual(zones.find((z: { id: string }) => z.id === 'smoke-zone'), { ...zone, description: 'edited' })
assert.equal((await call('PUT', '/api/zones/missing', zone)).status, 404)
assert.equal((await call('DELETE', '/api/devices/smoke-pi')).status, 409)
step('device / camera / zone CRUD, duplicate, FK and validation errors')

assert.equal((await call('GET', '/api/config', undefined, 'bad-token')).status, 401)
const cfg = (await call('GET', '/api/config', undefined, dev.data.token)).data
assert.deepEqual(cfg.cameras, [{ id: 'smoke-cam', device: '/dev/video0', fps: 1, resolution: [1920, 1080] }])
assert.deepEqual(cfg.zones, [{ id: 'smoke-zone', camera: 'smoke-cam', description: 'edited', vertices: zone.vertices, seats: zone.seats }])
assert.equal(typeof cfg.thresholds.confidence, 'number')
assert.equal(cfg.cloud.api_url, `${base}/api/occupancy`)
step('device config has config.json shape')

const post = (occupancy: object, timestamp: string) =>
  call('POST', '/api/occupancy', { device_id: 'ignored', timestamp, occupancy }, dev.data.token)
const now = new Date().toISOString().replace('Z', '+00:00')
const s0 = 'smoke-zone_s00', s1 = 'smoke-zone_s01'
assert.equal((await post({ [s0]: { status: 'occupied', count: 3 }, [s1]: { status: 'empty' } }, now)).data.changed, 2)
assert.equal((await post({ [s0]: { status: 'occupied', count: 4 }, [s1]: { status: 'empty' } }, now)).data.changed, 0)
const hourAgo = new Date(Date.now() - 3600_000).toISOString()
assert.equal((await post({ [s0]: { status: 'empty' } }, hourAgo)).data.changed, 1)
assert.equal((await post({ [s0]: { status: 'bogus' } }, now)).status, 400)
const cur = (await call('GET', '/api/occupancy/current')).data
assert.equal(cur.seats.find((s: { seat_id: string }) => s.seat_id === s0).status, 'occupied')
assert.ok(cur.devices.find((d: { id: string }) => d.id === 'smoke-pi').last_seen_at)
const events = (await call('GET', '/api/occupancy/events')).data.filter((e: { seat_id: string }) => e.seat_id.startsWith('smoke-zone'))
assert.equal(events.length, 3)
assert.equal((await call('DELETE', '/api/occupancy/events', { ids: events.map((e: { id: number }) => e.id) })).data.deleted, 3)
step('occupancy: change-only writes, stale payload does not overwrite, events deletable')

const rotated = (await call('POST', '/api/devices/smoke-pi/token')).data.token
assert.equal((await call('GET', '/api/config', undefined, dev.data.token)).status, 401)
assert.equal((await call('GET', '/api/config', undefined, rotated)).status, 200)
step('token rotation revokes the old token')

const th = (await call('GET', '/api/settings/thresholds')).data
assert.equal((await call('PUT', '/api/settings/thresholds', { ...th, confirm_frames: 0 })).status, 400)
assert.deepEqual((await call('PUT', '/api/settings/thresholds', th)).data, th)
step('thresholds read / validate / write')

const a = await call('POST', '/api/admins', { email: 'smoke@example.com', name: 'S', password: 'smoke-pass-123' })
assert.equal(a.status, 201)
assert.ok(!('password_hash' in a.data))
assert.equal((await call('PUT', `/api/admins/${a.data.id}`, { email: 'smoke@example.com', name: 'S2', password: '' })).data.name, 'S2')
assert.equal((await call('DELETE', `/api/admins/${a.data.id}`)).status, 204)
assert.equal((await call('DELETE', `/api/admins/${me.id}`)).status, 400)
step('admin CRUD, cannot delete self')

assert.equal((await call('DELETE', '/api/zones/smoke-zone')).status, 204)
assert.equal((await call('DELETE', '/api/cameras/smoke-cam')).status, 204)
assert.equal((await call('DELETE', '/api/devices/smoke-pi')).status, 204)
assert.equal((await call('DELETE', '/api/devices/smoke-pi')).status, 404)
await call('POST', '/api/auth/logout')
assert.equal((await call('GET', '/api/auth/me')).status, 401)
step('cleanup and logout')
