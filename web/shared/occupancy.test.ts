import { describe, expect, it } from 'vitest'
import { countPublic, publicTables, seatId } from './occupancy'
import { type SeatStatus } from './schemas'

const s = (name: string) => ({ name })
// Table 0 has seats A1, A2; table 1 has B1, B2.
const zone = { id: 'A', seats: [[s('A1'), s('A2')], [s('B1'), s('B2')]] }

describe('seatId', () => {
  it('matches main.py _sid', () => {
    expect(seatId('zone_A', 3, 12)).toBe('zone_A_t03_s12')
  })
})

describe('publicTables', () => {
  const seats = new Map<string, SeatStatus>([
    ['A_t00_s00', 'empty'],
    ['A_t00_s01', 'occupied'],
    ['A_t01_s00', 'confirming'],
    // A_t01_s01 has no row yet; A_t05_s00 is left behind by a shrunk zone.
    ['A_t05_s00', 'occupied'],
  ])

  it('maps seat states for a trusted camera', () => {
    expect(publicTables(zone, seats, 'ok')).toEqual([
      [
        { name: 'A1', state: 'empty' },
        { name: 'A2', state: 'used' },
      ],
      [
        { name: 'B1', state: 'used' },
        { name: 'B2', state: 'unknown' },
      ],
    ])
  })

  it('makes every seat unknown when the camera is not trusted', () => {
    for (const status of ['read_failed', 'offline', undefined])
      expect(
        publicTables(zone, seats, status)
          .flat()
          .every((seat) => seat.state === 'unknown')
      ).toBe(true)
  })
})

describe('countPublic', () => {
  it('counts vacant tables, vacant seats and seats in use', () => {
    const t = (...states: ('empty' | 'used' | 'unknown')[]) =>
      states.map((state) => ({ name: '', state }))
    expect(
      countPublic([t('empty', 'empty'), t('empty', 'used'), t('unknown'), t('empty')])
    ).toEqual({
      empty_tables: 2,
      empty_seats: 4,
      used_seats: 1,
      unknown_seats: 1,
    })
  })
})
