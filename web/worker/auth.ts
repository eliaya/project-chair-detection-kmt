// Web Crypto helpers, shared by the Worker and scripts/create-admin.ts (Node).
const enc = new TextEncoder()
// workerd rejects PBKDF2 iteration counts above 100k; the count is stored in each hash.
const ITERATIONS = 100_000

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0)
  )

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  )
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`
}

// Same cost as a real check, so unknown emails are not distinguishable by timing.
export const DUMMY_HASH = `pbkdf2$${ITERATIONS}$${'A'.repeat(22)}$${'A'.repeat(43)}`

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2') return false
  const actual = await pbkdf2(password, fromB64url(salt), Number(iterations))
  const expected = fromB64url(hash)
  return (
    actual.byteLength === expected.byteLength &&
    crypto.subtle.timingSafeEqual(actual, expected)
  )
}

const hmacKey = (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )

export async function signSession(sub: number, secret: string, ttlS: number) {
  const body = b64url(
    enc.encode(JSON.stringify({ sub, exp: Date.now() + ttlS * 1000 }))
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    enc.encode(body)
  )
  return `${body}.${b64url(sig)}`
}

export async function verifySession(token: string, secret: string) {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromB64url(sig),
      enc.encode(body)
    )
    if (!ok) return null
    const { sub, exp } = JSON.parse(new TextDecoder().decode(fromB64url(body)))
    return typeof sub === 'number' && exp > Date.now() ? sub : null
  } catch {
    return null
  }
}

export const sha256 = async (s: string) =>
  b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)))

export const randomToken = () =>
  b64url(crypto.getRandomValues(new Uint8Array(32)))

// Constant-time comparison of two secrets of any length (hashed to a fixed size first).
export async function secretEquals(a: string, b: string) {
  const [x, y] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s)))
  )
  return crypto.subtle.timingSafeEqual(x, y)
}
