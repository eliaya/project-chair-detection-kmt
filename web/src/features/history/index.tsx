import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef, type Table } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { seatStatusLabel } from '@/lib/seat-status'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableBulkActions,
  DataTableColumnHeader,
} from '@/components/data-table'
import { PageShell } from '@/components/layout/page-shell'
import { DataTable } from '@/features/resources/data-table'
import { type SeatStatus, seatStatuses } from '../../../shared/schemas'

type Event = {
  id: number
  seat_id: string
  device_id: string
  status: SeatStatus
  ts: string
}

// shortcut: newest 500 events, paged in the browser; add server-side paging when older history must be browsed.
const eventsQuery = {
  queryKey: ['occupancy', 'events'],
  queryFn: () =>
    api.get<Event[]>('/occupancy/events?limit=500').then((r) => r.data),
}

const columns: ColumnDef<Event>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label='すべて選択'
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        aria-label='行を選択'
      />
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'ts',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='日時' />
    ),
    cell: ({ row }) => new Date(row.original.ts).toLocaleString('ja-JP'),
    enableGlobalFilter: false,
  },
  {
    accessorKey: 'seat_id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='卓' />
    ),
  },
  {
    accessorKey: 'device_id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='デバイス' />
    ),
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='状態' />
    ),
    cell: ({ row }) => seatStatusLabel[row.original.status],
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
]

export function History() {
  const { data = [] } = useQuery(eventsQuery)

  return (
    <PageShell title='履歴' description='卓の状態が変化した記録（最新500件）'>
      <DataTable
        columns={columns}
        data={data}
        searchPlaceholder='卓・デバイスで絞り込み...'
        filters={[
          {
            columnId: 'status',
            title: '状態',
            options: seatStatuses.map((s) => ({
              value: s,
              label: seatStatusLabel[s],
            })),
          },
        ]}
        bulkActions={(table) => <BulkDelete table={table} />}
      />
    </PageShell>
  )
}

function BulkDelete({ table }: { table: Table<Event> }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const ids = table.getFilteredSelectedRowModel().rows.map((r) => r.original.id)
  const remove = useMutation({
    mutationFn: () => api.delete('/occupancy/events', { data: { ids } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventsQuery.queryKey })
      table.resetRowSelection()
      setOpen(false)
      toast.success(`${ids.length}件を削除しました`)
    },
  })

  return (
    <>
      <DataTableBulkActions table={table} entityName='event'>
        <Button variant='destructive' size='sm' onClick={() => setOpen(true)}>
          <Trash2 /> 削除
        </Button>
      </DataTableBulkActions>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title='履歴の削除'
        desc={`選択した${ids.length}件を削除しますか？この操作は取り消せません。`}
        cancelBtnText='キャンセル'
        confirmText='削除'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => remove.mutate()}
      />
    </>
  )
}
