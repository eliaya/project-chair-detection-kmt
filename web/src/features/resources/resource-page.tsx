import { useState } from 'react'
import { type z } from 'zod'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { DataTable } from './data-table'
import { type Field, FieldsForm } from './fields-form'

type Row = Record<string, unknown> & { id: string | number }

export type ResourceDef = {
  // API path and query key, e.g. 'zones' -> /api/zones
  key: string
  title: string
  description: string
  fields: Field[]
  createSchema: z.ZodType
  updateSchema?: z.ZodType
  defaults?: Record<string, unknown>
  columns: {
    key: string
    title: string
    format?: (value: unknown, row: Row) => string
  }[]
  // Adds "re-issue token" (POST /api/<key>/<id>/token)
  tokenRotation?: boolean
}

type DialogState = { type: 'form' | 'delete' | 'rotate'; row?: Row } | null

export function ResourcePage({ def }: { def: ResourceDef }) {
  const queryClient = useQueryClient()
  const { data = [] } = useQuery(listQuery<Row>(def.key))
  const [dialog, setDialog] = useState<DialogState>(null)
  const [token, setToken] = useState<string | null>(null)

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
      done('保存しました')
      if (data?.token) setToken(data.token)
    },
  })
  const remove = useMutation({
    mutationFn: (row: Row) => api.delete(`/${def.key}/${row.id}`),
    onSuccess: () => done('削除しました'),
  })
  const rotate = useMutation({
    mutationFn: (row: Row) =>
      api.post(`/${def.key}/${row.id}/token`).then((r) => r.data),
    onSuccess: (data) => {
      done('トークンを再発行しました')
      setToken(data.token)
    },
  })

  const columns: ColumnDef<Row>[] = [
    ...def.columns.map((c): ColumnDef<Row> => ({
      id: c.key,
      accessorFn: (r) =>
        c.format ? c.format(r[c.key], r) : String(r[c.key] ?? ''),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={c.title} />
      ),
    })),
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' className='size-8 p-0'>
              <DotsHorizontalIcon className='size-4' />
              <span className='sr-only'>操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onClick={() => setDialog({ type: 'form', row: row.original })}
            >
              <Pencil /> 編集
            </DropdownMenuItem>
            {def.tokenRotation && (
              <DropdownMenuItem
                onClick={() => setDialog({ type: 'rotate', row: row.original })}
              >
                <KeyRound /> トークン再発行
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              onClick={() => setDialog({ type: 'delete', row: row.original })}
            >
              <Trash2 /> 削除
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
      title={def.title}
      description={def.description}
      actions={
        <Button onClick={() => setDialog({ type: 'form' })}>
          <Plus /> 追加
        </Button>
      }
    >
      <DataTable columns={columns} data={data} />

      <Dialog
        open={dialog?.type === 'form'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader className='text-start'>
            <DialogTitle>
              {row ? `${def.title}を編集` : `${def.title}を追加`}
            </DialogTitle>
            <DialogDescription>{def.description}</DialogDescription>
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
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {row && (
        <ConfirmDialog
          open={dialog?.type === 'delete'}
          onOpenChange={(open) => !open && setDialog(null)}
          title='削除'
          desc={`「${label}」を削除しますか？この操作は取り消せません。`}
          cancelBtnText='キャンセル'
          confirmText='削除'
          destructive
          isLoading={remove.isPending}
          handleConfirm={() => remove.mutate(row)}
        />
      )}
      {row && (
        <ConfirmDialog
          open={dialog?.type === 'rotate'}
          onOpenChange={(open) => !open && setDialog(null)}
          title='トークン再発行'
          desc={`「${label}」の現在のトークンはすぐに無効になります。Pi の API_TOKEN を更新してください。`}
          cancelBtnText='キャンセル'
          confirmText='再発行'
          isLoading={rotate.isPending}
          handleConfirm={() => rotate.mutate(row)}
        />
      )}

      <Dialog open={!!token} onOpenChange={(open) => !open && setToken(null)}>
        <DialogContent>
          <DialogHeader className='text-start'>
            <DialogTitle>API トークン</DialogTitle>
            <DialogDescription>
              このトークンは二度と表示されません。Pi の環境変数 API_TOKEN
              に設定してください。
            </DialogDescription>
          </DialogHeader>
          <code className='rounded-md bg-muted p-3 font-mono text-sm break-all select-all'>
            {token}
          </code>
          <DialogFooter>
            <Button
              onClick={() =>
                navigator.clipboard
                  .writeText(token ?? '')
                  .then(() => toast.success('コピーしました'))
              }
            >
              コピー
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
