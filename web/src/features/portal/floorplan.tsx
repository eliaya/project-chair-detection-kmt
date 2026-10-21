import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import * as THREE from 'three'
import { type PublicSeat } from '../../../shared/occupancy'
import { Model } from '../../../vendor/blueprint3d/model/model'
import { Scene } from '../../../vendor/blueprint3d/model/scene'
import { Main as ThreeMain } from '../../../vendor/blueprint3d/three/main'
import { buildFurniture } from '../floorplan/furniture'

Scene.procedural = buildFurniture

const material = (color: number) =>
  new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
const materials: Record<PublicSeat['state'], THREE.Material> = {
  empty: material(0x10b981), // emerald-500
  used: material(0xef4444), // red-500
  unknown: material(0x9ca3af), // gray-400
}

// Mounted only while its tab is open. The plan changes rarely; query's structural
// sharing keeps the same object when it has not, so the scene is not rebuilt.
export function FloorplanTab({ states }: { states: PublicSeat['state'][] }) {
  const { t } = useI18n()
  const { data } = useQuery({
    queryKey: ['public', 'floorplan'],
    queryFn: async () => {
      const r = await fetch('/api/public/floorplan')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as object | null
    },
    refetchInterval: 60_000,
  })
  if (data === undefined) return null
  if (data === null)
    return (
      <p className='p-8 text-muted-foreground'>{t('portal.noFloorplan')}</p>
    )
  return <Viewer plan={data} states={states} />
}

// Read-only 3D floor plan; every item is coloured by its seat or table state.
function Viewer({
  plan,
  states,
}: {
  plan: object
  states: PublicSeat['state'][]
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<{ model: Model; three: ThreeMain } | null>(null)

  useEffect(() => {
    if (!host.current) return
    const el = document.createElement('div')
    el.className = 'size-full'
    host.current.append(el)
    const model = new Model('')
    const three = new ThreeMain(model, el, undefined, {
      resize: false,
      spin: false,
    })
    // Turning and zooming stay; selecting and dragging furniture do not.
    three.getController().enabled = false
    model.loadSerialized(JSON.stringify(plan))
    viewer.current = { model, three }
    const resize = new ResizeObserver(() => three.updateWindowSize())
    resize.observe(host.current)
    return () => {
      resize.disconnect()
      three.dispose()
      el.remove()
      viewer.current = null
    }
  }, [plan])

  useEffect(() => {
    if (!viewer.current) return
    const items = viewer.current.model.scene.getItems()
    // The plan is refetched less often; until it catches up, an edited plan shows grey.
    const fresh = items.length === states.length
    items.forEach((item, i) => {
      item.material = [materials[fresh ? states[i] : 'unknown']]
    })
    viewer.current.three.needsUpdate()
  }, [plan, states])

  return <div ref={host} className='size-full' />
}
