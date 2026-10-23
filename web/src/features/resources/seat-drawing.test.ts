import { describe, expect, it } from 'vitest'
import {
  addSeat,
  parseTables,
  removeLastSeat,
  type Point,
} from './seat-drawing'

const square: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
]

describe('parseTables', () => {
  it('reads seats JSON, and an empty text as no seats', () => {
    expect(parseTables('')).toEqual([])
    expect(parseTables('[[{"name":"A01","vertices":[[0,0]]}]]')).toEqual([
      [{ name: 'A01', vertices: [[0, 0]] }],
    ])
  })

  it('rejects text that is not seats', () => {
    expect(parseTables('[[')).toBeNull()
    expect(parseTables('{}')).toBeNull()
    expect(parseTables('[[{"name":"A01"}]]')).toBeNull()
    expect(parseTables('[[null]]')).toBeNull()
  })
})

describe('addSeat', () => {
  it('numbers seats across tables and starts a table on request', () => {
    let t = addSeat([], square, 'A', false)
    t = addSeat(t, square, 'A', false)
    t = addSeat(t, square, 'A', true)
    expect(t.map((table) => table.map((s) => s.name))).toEqual([
      ['A01', 'A02'],
      ['A03'],
    ])
  })
})

describe('removeLastSeat', () => {
  it('drops the last seat, then its emptied table', () => {
    const t = addSeat(addSeat([], square, 'A', false), square, 'A', true)
    expect(removeLastSeat(t)).toHaveLength(1)
    expect(removeLastSeat(removeLastSeat(t))).toEqual([])
    expect(removeLastSeat([])).toEqual([])
  })
})
