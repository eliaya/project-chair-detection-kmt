import { describe, expect, it } from 'vitest'
import { countPublic, seatId } from './occupancy'
import { type SeatStatus } from './schemas'

const seat = { name: 'A', vertices: [] }
// Zone A: table 0 has 2 seats, table 1 has 2 seats. Zone B: one 1-seat table.
const zones = [
  { id: 'A', camera_id: 'cam1', seats: [[seat, seat], [seat, seat]] },
  { id: 'B', camera_id: 'cam2', seats: [[seat]] },
]

describe('seatId', () => {
  it('matches main.py _sid', () => {
    expect(seatId('zone_A', 3, 12)).toBe('zone_A_t03_s12')
  })
})

describe('countPublic', () => {
  it('counts empty tables, empty seats and seats in use', () => {
    const seats = new Map<string, SeatStatus>([
      ['A_t00_s00', 'empty'],
      ['A_t00_s01', 'empty'],
      ['A_t01_s00', 'empty'],
      ['A_t01_s01', 'confirming'],
      ['B_t00_s00', 'leave_confirm'],
    ])
    const cams = new Map([
      ['cam1', 'ok'],
      ['cam2', 'not_reported'],
    ])
    expect(countPublic(zones, seats, cams)).toEqual({
      empty_tables: 1,
      empty_seats: 3,
      used_seats: 2,
      unknown_seats: 0,
    })
  })

  it('treats seats of an untrusted camera or without a row as unknown', () => {
    const seats = new Map<string, SeatStatus>([
      ['A_t00_s00', 'empty'],
      ['A_t00_s01', 'empty'],
      ['A_t01_s00', 'empty'],
      ['B_t00_s00', 'occupied'],
    ])
    // cam2 is missing: its device is offline.
    const cams = new Map([['cam1', 'ok']])
    expect(countPublic(zones, seats, cams)).toEqual({
      empty_tables: 1,
      empty_seats: 3,
      used_seats: 0,
      unknown_seats: 2,
    })
    expect(
      countPublic(zones, seats, new Map([['cam1', 'read_failed']])).unknown_seats
    ).toBe(5)
  })

  it('ignores seat rows left behind by a shrunk zone', () => {
    const seats = new Map<string, SeatStatus>([['A_t05_s00', 'occupied']])
    const cams = new Map([['cam1', 'ok']])
    expect(countPublic(zones.slice(0, 1), seats, cams).used_seats).toBe(0)
  })
})
