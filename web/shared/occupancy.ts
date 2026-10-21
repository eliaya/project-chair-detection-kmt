// Occupancy rules shared by the admin dashboard and the public portal endpoint.
import { type SeatStatus } from './schemas'

// Seats are only trusted while their camera works; "not_reported" means main.py
// predates the camera and still judges it from config it fetched earlier.
export const trustedCameras: readonly string[] = ['ok', 'not_reported']

const pad = (n: number) => String(n).padStart(2, '0')
// main.py reports seat j of table i as "<zone id>_t<ii>_s<jj>".
export const seatId = (zoneId: string, i: number, j: number) =>
  `${zoneId}_t${pad(i)}_s${pad(j)}`

// Public counts: a table is vacant only when every seat is empty; a seat someone
// is sitting down at (confirming) is not offered as free. Unknown seats count in neither.
export function countPublic(
  zones: { id: string; camera_id: string; seats: unknown[][] }[],
  seatStatus: Map<string, SeatStatus>,
  cameraStatus: Map<string, string>
) {
  const c = { empty_tables: 0, empty_seats: 0, used_seats: 0, unknown_seats: 0 }
  for (const zone of zones) {
    const trusted = trustedCameras.includes(cameraStatus.get(zone.camera_id) ?? 'offline')
    zone.seats.forEach((table, i) => {
      let allEmpty = true
      table.forEach((_, j) => {
        const s = trusted ? seatStatus.get(seatId(zone.id, i, j)) : undefined
        if (s === 'empty') c.empty_seats++
        else if (s) c.used_seats++
        else c.unknown_seats++
        allEmpty &&= s === 'empty'
      })
      if (allEmpty) c.empty_tables++
    })
  }
  return c
}
