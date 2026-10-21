import { useEffect, useRef, useState } from 'react'
import { type z } from 'zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { Eraser, MousePointer2, PenLine, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, listQuery } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageShell } from '@/components/layout/page-shell'
import { seatId, tableId } from '../../../shared/occupancy'
import { type zoneSchema } from '../../../shared/schemas'
import { Floorplanner } from '../../../vendor/blueprint3d/floorplanner/floorplanner'
import { floorplannerModes } from '../../../vendor/blueprint3d/floorplanner/floorplanner_view'
import type { Item } from '../../../vendor/blueprint3d/items/item'
import { Model } from '../../../vendor/blueprint3d/model/model'
import { Scene } from '../../../vendor/blueprint3d/model/scene'
import { Main as ThreeMain } from '../../../vendor/blueprint3d/three/main'
import { buildFurniture, furniture, type FurnitureKind } from './furniture'

Scene.procedural = buildFurniture

// A 12 m × 8 m room to start from (blueprint3d serialized form, cm).
const emptyPlan = {
  floorplan: {
    corners: {
      c1: { x: 0, y: 800 },
      c2: { x: 1200, y: 800 },
      c3: { x: 1200, y: 0 },
      c4: { x: 0, y: 0 },
    },
    walls: [
      { corner1: 'c4', corner2: 'c1' },
      { corner1: 'c1', corner2: 'c2' },
      { corner1: 'c2', corner2: 'c3' },
      { corner1: 'c3', corner2: 'c4' },
    ],
  },
  items: [],
}

const wallModes = {
  move: { mode: floorplannerModes.MOVE, icon: MousePointer2 },
  draw: { mode: floorplannerModes.DRAW, icon: PenLine },
  erase: { mode: floorplannerModes.DELETE, icon: Eraser },
} as const
type WallMode = keyof typeof wallModes

type Planner = { model: Model; three: ThreeMain; floorplanner: Floorplanner }
type Zone = z.infer<typeof zoneSchema>

// Chairs and stools stand for a seat, tables for a table; the portal colours them.
const binds: Record<string, 'seat' | 'table'> = {
  'proc:chair': 'seat',
  'proc:stool': 'seat',
  'proc:table2': 'table',
  'proc:table4': 'table',
  'proc:table6': 'table',
  'proc:round': 'table',
}

export function FloorplanPage() {
  const { t } = useI18n()
  // Loaded once: a refetch would rebuild the editor and drop unsaved changes.
  const plan = useQuery({
    queryKey: ['floorplan'],
    queryFn: () => api.get('/settings/floorplan').then((r) => r.data),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const wallsHost = useRef<HTMLDivElement>(null)
  const layoutHost = useRef<HTMLDivElement>(null)
  const planner = useRef<Planner | null>(null)
  const [tab, setTab] = useState<'walls' | 'layout'>('walls')
  const [wallMode, setWallMode] = useState<WallMode>('move')
  const [camera, setCamera] = useState<'2d' | '3d'>('3d')
  const [selected, setSelected] = useState<Item | null>(null)
  const [seat, setSeat] = useState<string>()
  const zones = useQuery(listQuery<Zone>('zones'))

  useEffect(() => {
    if (!plan.isSuccess || !wallsHost.current || !layoutHost.current) return
    // New elements on each mount: the library leaves its listeners on them.
    const canvas = document.createElement('canvas')
    canvas.id = 'floorplan-canvas'
    wallsHost.current.append(canvas)
    const viewer = document.createElement('div')
    viewer.className = 'size-full'
    layoutHost.current.append(viewer)

    const model = new Model('')
    const three = new ThreeMain(model, viewer, undefined, {
      resize: false,
      spin: false,
    })
    const floorplanner = new Floorplanner(canvas.id, model.floorplan)
    three.itemSelectedCallbacks.add((item) => {
      setSelected(item)
      setSeat(item.metadata.seat)
    })
    three.itemUnselectedCallbacks.add(() => setSelected(null))
    model.loadSerialized(JSON.stringify(plan.data ?? emptyPlan))
    planner.current = { model, three, floorplanner }

    // Panes start or become hidden (0 px), so size them whenever they change.
    const resize = new ResizeObserver(() => {
      three.updateWindowSize()
      floorplanner.resizeView()
    })
    resize.observe(wallsHost.current)
    resize.observe(layoutHost.current)
    return () => {
      resize.disconnect()
      three.dispose()
      floorplanner.destroy()
      canvas.remove()
      viewer.remove()
      planner.current = null
      setSelected(null)
    }
  }, [plan.isSuccess, plan.data])

  const save = useMutation({
    mutationFn: () =>
      api.put(
        '/settings/floorplan',
        JSON.parse(planner.current!.model.exportSerialized())
      ),
    onSuccess: () => toast.success(t('common.saved')),
  })

  const changeWallMode = (m: string) => {
    if (!m) return
    setWallMode(m as WallMode)
    planner.current?.floorplanner.setMode(wallModes[m as WallMode].mode)
  }
  const changeCamera = (c: string) => {
    if (!c) return
    setCamera(c as '2d' | '3d')
    planner.current?.three.setViewMode(c as '2d' | '3d')
  }
  const add = (kind: FurnitureKind) =>
    planner.current?.model.scene.addItem(1, `proc:${kind}`, {
      itemName: t(furniture[kind].label),
      itemType: 1,
      modelUrl: `proc:${kind}`,
    })
  const bind = (v: string) => {
    if (!selected) return
    // The item is a three.js object kept in state only to re-render; it is meant to change.
    // eslint-disable-next-line react-hooks/immutability
    selected.metadata.seat = v === 'none' ? undefined : v
    setSeat(selected.metadata.seat)
  }
  const bindKind = selected && binds[selected.metadata.modelUrl ?? '']
  const remove = () => {
    if (!selected) return
    selected.removeFromScene()
    selected.geometry.dispose()
  }

  return (
    <PageShell
      title={t('nav.floorplan')}
      description={t('floorplan.desc')}
      actions={
        <Button
          onClick={() => save.mutate()}
          disabled={!plan.isSuccess || save.isPending}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value='walls'>{t('floorplan.walls')}</TabsTrigger>
            <TabsTrigger value='layout'>{t('floorplan.layout')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === 'walls' ? (
          <ToggleGroup
            type='single'
            variant='outline'
            value={wallMode}
            onValueChange={changeWallMode}
            aria-label={t('floorplan.wallTool')}
          >
            {Object.entries(wallModes).map(([key, { icon: Icon }]) => (
              <ToggleGroupItem key={key} value={key} className='px-3'>
                <Icon />
                {t(`floorplan.${key as WallMode}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <>
            <ToggleGroup
              type='single'
              variant='outline'
              value={camera}
              onValueChange={changeCamera}
              aria-label={t('floorplan.camera')}
            >
              <ToggleGroupItem value='2d' className='px-3'>
                {t('floorplan.top')}
              </ToggleGroupItem>
              <ToggleGroupItem value='3d' className='px-3'>
                {t('floorplan.angle')}
              </ToggleGroupItem>
            </ToggleGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline'>
                  <Plus />
                  {t('floorplan.add')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start'>
                {Object.entries(furniture).map(([kind, f]) => (
                  <DropdownMenuItem
                    key={kind}
                    onSelect={() => add(kind as FurnitureKind)}
                  >
                    {t(f.label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant='outline' disabled={!selected} onClick={remove}>
              <Trash2 />
              {t('floorplan.delete')}
            </Button>
            {bindKind && (
              <Select value={seat ?? 'none'} onValueChange={bind}>
                <SelectTrigger
                  className='min-w-40'
                  aria-label={t(`floorplan.${bindKind}`)}
                >
                  <span className='text-muted-foreground'>
                    {t(`floorplan.${bindKind}`)}
                  </span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>{t('floorplan.unbound')}</SelectItem>
                  {zones.data?.map((zone) => (
                    <SelectGroup key={zone.id}>
                      <SelectLabel>{zone.id}</SelectLabel>
                      {zone.seats.flatMap((seats, i) =>
                        bindKind === 'table' ? (
                          <SelectItem key={i} value={tableId(zone.id, i)}>
                            {seats.map((s) => s.name).join(' · ')}
                          </SelectItem>
                        ) : (
                          seats.map((s, j) => (
                            <SelectItem
                              key={`${i}-${j}`}
                              value={seatId(zone.id, i, j)}
                            >
                              {s.name}
                            </SelectItem>
                          ))
                        )
                      )}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}
      </div>
      <p className='text-sm text-muted-foreground'>
        {t(
          tab === 'walls'
            ? `floorplan.hint.${wallMode}`
            : 'floorplan.hint.layout'
        )}
      </p>
      <Card className='relative h-[calc(100svh-18rem)] min-h-96 overflow-hidden p-0'>
        <div
          ref={wallsHost}
          className={cn('absolute inset-0', tab !== 'walls' && 'hidden')}
        />
        <div
          ref={layoutHost}
          className={cn('absolute inset-0', tab !== 'layout' && 'hidden')}
        />
      </Card>
    </PageShell>
  )
}
