// Create an admin account in D1, or reset the password of an existing email.
// Usage: npm run admin:create -- <email> [name] [--remote]
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { adminCreateSchema } from '../shared/schemas.ts'
import { hashPassword } from '../worker/auth.ts'

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const [email, name = ''] = args.filter((a) => a !== '--remote')

const tty = process.stdin.isTTY
const rl = createInterface({ input: process.stdin, output: process.stdout })
if (tty) execFileSync('stty', ['-echo'], { stdio: 'inherit' })
const password = await rl.question('Password (8+ chars): ')
if (tty) execFileSync('stty', ['echo'], { stdio: 'inherit' })
rl.close()
process.stdout.write('\n')

const d = adminCreateSchema.parse({ email, name, password })
// `d1 execute --command` has no bind parameters; quote as SQLite string literals.
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const sql = `INSERT INTO admins (email, name, password_hash) VALUES (${lit(d.email)}, ${lit(d.name)}, ${lit(await hashPassword(d.password))})
  ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash,
    name = COALESCE(NULLIF(excluded.name, ''), admins.name)`
execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'kmt-occupancy', remote ? '--remote' : '--local', '--command', sql],
  { stdio: 'inherit' }
)
