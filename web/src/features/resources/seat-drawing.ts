// The zone's "seats" value (one array of seats per table), as draw_zones.py builds it.
export type Point = [number, number]
export type Seat = { name: string; vertices: Point[] }

// The seats text as tables, or null when it is not seats-shaped JSON (an empty text is no seats).
export function parseTables(text: string): Seat[][] | null {
  try {
    const v: unknown = JSON.parse(text.trim() || '[]')
    const ok =
      Array.isArray(v) &&
      v.every(
        (t) =>
          Array.isArray(t) &&
          t.every((s) => Array.isArray((s as Seat | null)?.vertices))
      )
    return ok ? (v as Seat[][]) : null
  } catch {
    return null
  }
}

// The polygon as the next seat (<prefix>01, 02, ...), in the last table or, with newTable, a new one.
export function addSeat(
  tables: Seat[][],
  vertices: Point[],
  prefix: string,
  newTable: boolean
): Seat[][] {
  const n = tables.flat().length + 1
  const seat = { name: `${prefix}${String(n).padStart(2, '0')}`, vertices }
  const last = tables[tables.length - 1]
  return newTable || !last
    ? [...tables, [seat]]
    : [...tables.slice(0, -1), [...last, seat]]
}

// Drops the last seat, and its table when that was the table's only seat.
export function removeLastSeat(tables: Seat[][]): Seat[][] {
  const last = tables[tables.length - 1]
  if (!last) return tables
  return last.length > 1
    ? [...tables.slice(0, -1), last.slice(0, -1)]
    : tables.slice(0, -1)
}
