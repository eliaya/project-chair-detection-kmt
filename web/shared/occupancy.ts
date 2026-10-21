// Occupancy rules shared by the admin dashboard and the public portal endpoint.
import { type SeatStatus } from './schemas'

// Seats are only trusted while their camera works; "not_reported" means main.py
// predates the camera and still judges it from config it fetched earlier.
export const trustedCameras: readonly string[] = ['ok', 'not_reported']

const pad = (n: number) => String(n).padStart(2, '0')
// main.py reports seat j of table i as "<zone id>_t<ii>_s<jj>".
export const seatId = (zoneId: string, i: number, j: number) =>
  `${zoneId}_t${pad(i)}_s${pad(j)}`

export type PublicSeat = { name: string; state: 'empty' | 'used' | 'unknown' }

// Public view of one zone's tables: a seat someone is sitting down at (confirming)
// is not offered as free; an untrusted camera or a missing row makes a seat unknown.
export function publicTables(
  zone: { id: string; seats: { name: string }[][] },
  seatStatus: Map<string, SeatStatus>,
  cameraStatus: string | undefined
): PublicSeat[][] {
  const trusted = trustedCameras.includes(cameraStatus ?? 'offline')
  return zone.seats.map((table, i) =>
    table.map((seat, j) => {
      const s = trusted ? seatStatus.get(seatId(zone.id, i, j)) : undefined
      return {
        name: seat.name,
        state: !s ? 'unknown' : s === 'empty' ? 'empty' : 'used',
      }
    })
  )
}

// A table is vacant only when every seat is empty. Unknown seats count in neither.
export function countPublic(tables: PublicSeat[][]) {
  const seats = tables.flat()
  const n = (state: PublicSeat['state']) =>
    seats.filter((s) => s.state === state).length
  return {
    empty_tables: tables.filter((t) => t.every((s) => s.state === 'empty'))
      .length,
    empty_seats: n('empty'),
    used_seats: n('used'),
    unknown_seats: n('unknown'),
  }
}
