import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { parseTables } from './seat-drawing'
import { SeatsEditor } from './seats-editor'

// A 200 × 100 px snapshot, shown 400 px wide: image pixels are half the screen offsets.
async function snapshot() {
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 100
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!)))
  return new File([blob], 'cam1.png', { type: 'image/png' })
}

function Harness() {
  const [text, setText] = useState('')
  return (
    <div style={{ width: 400 }}>
      <SeatsEditor value={text} onChange={setText} />
      <output data-testid='json'>{text}</output>
    </div>
  )
}

describe('SeatsEditor', () => {
  it('turns clicks on the snapshot into a seat in image pixels', async () => {
    const screen = await render(<Harness />)
    await userEvent.upload(screen.getByLabelText(/snapshot/i), await snapshot())
    const image = screen.getByRole('img')
    for (const [x, y] of [
      [40, 20],
      [120, 20],
      [120, 100],
    ])
      await userEvent.click(image, { position: { x, y } })
    await userEvent.click(screen.getByRole('button', { name: /finish seat/i }))

    const tables = parseTables(
      screen.getByTestId('json').element().textContent ?? ''
    )
    expect(tables).toHaveLength(1)
    const [seat] = tables![0]
    expect(seat.name).toBe('A01')
    const want = [
      [20, 10],
      [60, 10],
      [60, 50],
    ]
    seat.vertices.forEach(([x, y], i) => {
      expect(Math.abs(x - want[i][0])).toBeLessThanOrEqual(1)
      expect(Math.abs(y - want[i][1])).toBeLessThanOrEqual(1)
    })
  })
})
