// History rules shared by the Worker (ingest, /api/v1) and the tests.
import { z } from 'zod'
import { type SeatStatus } from './schemas'

// A stay runs from "occupied" until "empty", as main.py times it; a seat that is
// only "confirming" (not seated yet) still counts as empty.
export const isUsed = (s: SeatStatus) =>
  s === 'occupied' || s === 'leave_confirm'

// "<zone id>_t<ii>_s<jj>" -> "<zone id>_t<ii>"
export const tableOf = (seatId: string) => seatId.slice(0, -4)

// Whether each table is empty: every one of its seats is empty.
export function emptyTables(seats: Map<string, SeatStatus>) {
  const empty = new Map<string, boolean>()
  for (const [id, s] of seats)
    empty.set(tableOf(id), (empty.get(tableOf(id)) ?? true) && !isUsed(s))
  return empty
}

export const historyKinds = ['seat_used', 'seat_empty', 'table_empty'] as const

const isoTime = z.iso
  .datetime({ offset: true })
  // Stored times are ISO-Z, so they compare as strings.
  .transform((s) => new Date(s).toISOString())

// Query of GET /api/v1/history; the descriptions go into /api/v1/openapi.json.
export const historyQuerySchema = z.object({
  kind: z
    .enum(historyKinds)
    .optional()
    .describe('seat_used: 座席の利用、seat_empty: 空席、table_empty: 空きテーブル'),
  target: z
    .string()
    .max(64)
    .optional()
    .describe('座席 ID（<zone>_tII_sJJ）またはテーブル ID（<zone>_tII）'),
  from: isoTime.optional().describe('ended_at がこの時刻以降（ISO 8601）'),
  to: isoTime.optional().describe('ended_at がこの時刻より前（ISO 8601）'),
  after: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('この id より後の記録（前回の next_after）'),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})
