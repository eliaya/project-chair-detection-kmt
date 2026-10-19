import { type Key } from '@/i18n'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Tables and chairs built from boxes and cylinders (lengths in cm), so the plan
// needs no model downloads and stays light on old integrated GPUs.
const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number
) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z)
const cylinder = (r: number, h: number, y: number) =>
  new THREE.CylinderGeometry(r, r, h, 16).translate(0, y + h / 2, 0)

function table(w: number, d: number, h = 72) {
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => box(5, h - 4, 5, sx * (w / 2 - 6), 0, sz * (d / 2 - 6)))
  )
  return [box(w, 4, d, 0, h - 4, 0), ...legs]
}

const wood = 0xb08968
const fabric = 0x64748b

export const furniture = {
  table2: {
    label: 'floorplan.table2',
    color: wood,
    parts: () => table(75, 75),
  },
  table4: {
    label: 'floorplan.table4',
    color: wood,
    parts: () => table(120, 75),
  },
  table6: {
    label: 'floorplan.table6',
    color: wood,
    parts: () => table(180, 80),
  },
  round: {
    label: 'floorplan.round',
    color: wood,
    parts: () => [cylinder(45, 4, 68), cylinder(5, 68, 0)],
  },
  counter: {
    label: 'floorplan.counter',
    color: wood,
    parts: () => [box(240, 105, 55, 0, 0, 0)],
  },
  chair: {
    label: 'floorplan.chair',
    color: fabric,
    parts: () => [
      box(42, 5, 42, 0, 43, 0),
      box(42, 40, 4, 0, 48, -19),
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => box(4, 43, 4, sx * 18, 0, sz * 18))
      ),
    ],
  },
  stool: {
    label: 'floorplan.stool',
    color: fabric,
    parts: () => [cylinder(17, 4, 71), cylinder(3, 71, 0)],
  },
} satisfies Record<
  string,
  { label: Key; color: number; parts: () => THREE.BufferGeometry[] }
>

export type FurnitureKind = keyof typeof furniture

// One material per colour, shared by every item; Lambert is the cheapest lit material.
const materials = new Map<number, THREE.Material>()

/** Mesh for a "proc:<kind>" model URL (vendor/blueprint3d Scene.procedural). */
export function buildFurniture(kind: string) {
  const f = furniture[kind as FurnitureKind] ?? furniture.table4
  const parts = f.parts()
  const geometry = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  // Items get a material array, which three.js draws only through groups.
  geometry.addGroup(0, geometry.index!.count, 0)
  if (!materials.has(f.color))
    materials.set(f.color, new THREE.MeshLambertMaterial({ color: f.color }))
  return { geometry, materials: [materials.get(f.color)!] }
}
