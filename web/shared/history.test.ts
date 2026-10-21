import { describe, expect, it } from 'vitest'
import { emptyTables, historyQuerySchema, isUsed, tableOf } from './history'
import { type SeatStatus } from './schemas'

describe('isUsed', () => {
  it('counts a stay from occupied until empty', () => {
    expect(isUsed('occupied')).toBe(true)
    expect(isUsed('leave_confirm')).toBe(true)
    expect(isUsed('confirming')).toBe(false)
    expect(isUsed('empty')).toBe(false)
  })
})

describe('tableOf', () => {
  it('drops the seat part of a seat id', () => {
    expect(tableOf('zone_A_t03_s12')).toBe('zone_A_t03')
  })
})

describe('emptyTables', () => {
  it('is empty only when every seat is empty', () => {
    const seats = new Map<string, SeatStatus>([
      ['A_t00_s00', 'empty'],
      ['A_t00_s01', 'confirming'],
      ['A_t01_s00', 'empty'],
      ['A_t01_s01', 'leave_confirm'],
    ])
    expect(emptyTables(seats)).toEqual(
      new Map([
        ['A_t00', true],
        ['A_t01', false],
      ])
    )
  })
})

describe('historyQuerySchema', () => {
  it('normalizes times and applies defaults', () => {
    expect(
      historyQuerySchema.parse({ from: '2026-10-21T09:00:00+09:00' })
    ).toEqual({ from: '2026-10-21T00:00:00.000Z', after: 0, limit: 500 })
  })
  it('rejects bad input', () => {
    expect(historyQuerySchema.safeParse({ limit: '5000' }).success).toBe(false)
    expect(historyQuerySchema.safeParse({ kind: 'x' }).success).toBe(false)
    expect(historyQuerySchema.safeParse({ to: 'yesterday' }).success).toBe(false)
  })
})
