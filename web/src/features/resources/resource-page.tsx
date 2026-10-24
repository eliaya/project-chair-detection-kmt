import { useState } from 'react'
import { type z } from 'zod'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { type I18n, type Key, useI18n } from '@/i18n'
import { KeyRound, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import { api, listQuery } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableColumnHeader } from '@/components/data-table'
import { PageShell } from '@/components/layout/page-shell'
import { CopyBlock, type Device, DeviceConnection } from './connection'
import { DataTable } from './data-table'
import { type Field, FieldsForm } from './fields-form'
import { LiveView } from './live-view'

type Row = Record<string, unknown> & { id: string | number }

export type ResourceDef = {
  // API path and query key, e.g. 'zones' -> /api/zones
  key: string
  title: Key
  // Singular noun for the add/edit dialog titles
  item: Key
  description: Key
  fields: Field[]
  createSchema: z.ZodType
  updateSchema?: z.ZodType
  defaults?: Record<string, unknown>
  columns: {
    key: string
    title: Key
    // Text for sorting and search; cell, if given, is what is shown.
    format?: (value: unknown, row: Row, i18n: I18n) => string
    cell?: (row: Row, i18n: I18n) => React.ReactNode
  }[]
  // Adds "re-issue token" (POST /api/<key>/<id>/token); devices also get the Pi connection check
  tokenRotation?: boolean
  // Token dialog texts, when the defaults (which talk about the Pi) do not fit
  tokenDesc?: Key
  rotateDesc?: Key
  // Polls the list, for live statuses
  refetchInterval?: number
  // Adds "live view" (cameras: GET /api/cameras/<id>/live, a WebSocket)
  liveView?: boolean
}

type DialogState = {
  type: 'form' | 'delete' | 'rotate' | 'live'
  row?: Row
} | null

export function ResourcePage({ def }: { def: ResourceDef }) {
  const queryClient = useQueryClient()
  const i18n = useI18n()
  const { t } = i18n
  const { data = [] } = useQuery({
    ...listQuery<Row>(def.key),
    refetchInterval: def.refetchInterval,
  })
  const [dialog, setDialog] = useState<DialogState>(null)
  // A new or re-issued token, with the device row as it was when issued
  const [token, setToken] = useState<{ token: string; row: Row } | null>(null)

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: [def.key] })
    setDialog(null)
    toast.success(message)
  }
  const save = useMutation({
    mutationFn: ({ row, values }: { row?: Row; values: object }) =>
      (row
        ? api.put(`/${def.key}/${row.id}`, values)
        : api.post(`/${def.key}`, values)
      ).then((r) => r.data),
    onSuccess: (data) => {
      done(t('common.saved'))
      if (data?.token) setToken({ token: data.token, row: data })
    },
  })
  const remove = useMutation({
    mutationFn: (row: Row) => api.delete(`/${def.key}/${row.id}`),
    onSuccess: () => done(t('common.deleted')),
  })
  const rotate = useMutation({
    mutationFn: (row: Row) =>
      api.post(`/${def.key}/${row.id}/token`).then((r) => r.data),
    onSuccess: (data) => {
      done(t('resource.rotated'))
      setToken({ token: data.token, row: data })
    },
  })

  const columns: ColumnDef<Row>[] = [
    ...def.columns.map((c): ColumnDef<Row> => ({
      id: c.key,
      accessorFn: (r) =>
        c.format ? c.format(r[c.key], r, i18n) : String(r[c.key] ?? ''),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t(c.title)} />
      ),
      ...(c.cell && { cell: ({ row }) => c.cell!(row.original, i18n) }),
    })),
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' className='size-8 p-0'>
              <DotsHorizontalIcon className='size-4' />
              <span className='sr-only'>{t('common.actions')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {def.liveView && (
              <DropdownMenuItem
                onClick={() => setDialog({ type: 'live', row: row.original })}
              >
                <Video /> {t('live.open')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => setDialog({ type: 'form', row: row.original })}
            >
              <Pencil /> {t('common.edit')}
            </DropdownMenuItem>
            {def.tokenRotation && (
              <DropdownMenuItem
                onClick={() => setDialog({ type: 'rotate', row: row.original })}
              >
                <KeyRound /> {t('resource.rotate')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              onClick={() => setDialog({ type: 'delete', row: row.original })}
            >
              <Trash2 /> {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const row = dialog?.row
  const label = String(row?.email ?? row?.id ?? '')

  return (
    <PageShell
      title={t(def.title)}
      description={t(def.description)}
      actions={
        <Button onClick={() => setDialog({ type: 'form' })}>
          <Plus /> {t('common.add')}
        </Button>
      }
    >
      <DataTable columns={columns} data={data} />

      <Dialog
        open={dialog?.type === 'form'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent
          className={
            // Room for the seat drawing
            def.fields.some((f) => f.type === 'seats')
              ? 'sm:max-w-4xl'
              : 'sm:max-w-lg'
          }
        >
          <DialogHeader className='text-start'>
            <DialogTitle>
              {t(row ? 'resource.editTitle' : 'resource.addTitle', {
                name: t(def.item),
              })}
            </DialogTitle>
            <DialogDescription>{t(def.description)}</DialogDescription>
          </DialogHeader>
          {dialog?.type === 'form' && (
            <div className='max-h-[60vh] overflow-y-auto px-0.5 py-1'>
              <FieldsForm
                id='resource-form'
                fields={def.fields}
                schema={
                  row
                    ? (def.updateSchema ?? def.createSchema)
                    : def.createSchema
                }
                initial={row ?? def.defaults}
                isEdit={!!row}
                onValid={(values) => save.mutate({ row, values })}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type='submit'
              form='resource-form'
              disabled={save.isPending}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {row && (
        <ConfirmDialog
          open={dialog?.type === 'delete'}
          onOpenChange={(open) => !open && setDialog(null)}
          title={t('common.delete')}
          desc={t('resource.deleteDesc', { label })}
          cancelBtnText={t('common.cancel')}
          confirmText={t('common.delete')}
          destructive
          isLoading={remove.isPending}
          handleConfirm={() => remove.mutate(row)}
        />
      )}
      {row && (
        <ConfirmDialog
          open={dialog?.type === 'rotate'}
          onOpenChange={(open) => !open && setDialog(null)}
          title={t('resource.rotate')}
          desc={t(def.rotateDesc ?? 'resource.rotateDesc', { label })}
          cancelBtnText={t('common.cancel')}
          confirmText={t('resource.rotateConfirm')}
          isLoading={rotate.isPending}
          handleConfirm={() => rotate.mutate(row)}
        />
      )}

      <Dialog
        open={dialog?.type === 'live'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className='sm:max-w-4xl'>
          <DialogHeader className='text-start'>
            <DialogTitle>{t('live.title', { camera: label })}</DialogTitle>
            <DialogDescription>{t('live.legend')}</DialogDescription>
          </DialogHeader>
          {dialog?.type === 'live' && row && (
            <LiveView camera={String(row.id)} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!token} onOpenChange={(open) => !open && setToken(null)}>
        <DialogContent>
          <DialogHeader className='text-start'>
            <DialogTitle>{t('resource.tokenTitle')}</DialogTitle>
            <DialogDescription>
              {t(def.tokenDesc ?? 'resource.tokenDesc')}
            </DialogDescription>
          </DialogHeader>
          {token && def.key !== 'devices' && <CopyBlock text={token.token} />}
          {token && def.key === 'devices' && (
            <DeviceConnection
              token={token.token}
              issued={token.row as unknown as Device}
              current={
                data.find((r) => r.id === token.row.id) as unknown as Device
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
