import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef, type Table } from '@tanstack/react-table'
import { type I18n, useI18n } from '@/i18n'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
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

const columns = ({ t, lang }: I18n): ColumnDef<Event>[] => [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label={t('table.selectAll')}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        aria-label={t('table.selectRow')}
      />
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'ts',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('history.time')} />
    ),
    cell: ({ row }) => new Date(row.original.ts).toLocaleString(lang),
    enableGlobalFilter: false,
  },
  {
    accessorKey: 'seat_id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('history.table')} />
    ),
  },
  {
    accessorKey: 'device_id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('field.device')} />
    ),
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('history.status')} />
    ),
    cell: ({ row }) => t(`status.${row.original.status}`),
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
]

export function History() {
  const { data = [] } = useQuery(eventsQuery)
  const i18n = useI18n()
  const { t } = i18n
  // TanStack Table needs a stable columns reference.
  const cols = useMemo(() => columns(i18n), [i18n])

  return (
    <PageShell title={t('nav.history')} description={t('history.desc')}>
      <DataTable
        columns={cols}
        data={data}
        searchPlaceholder={t('history.searchPlaceholder')}
        filters={[
          {
            columnId: 'status',
            title: t('history.status'),
            options: seatStatuses.map((s) => ({
              value: s,
              label: t(`status.${s}`),
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
  const { t } = useI18n()
  const ids = table.getFilteredSelectedRowModel().rows.map((r) => r.original.id)
  const remove = useMutation({
    mutationFn: () => api.delete('/occupancy/events', { data: { ids } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventsQuery.queryKey })
      table.resetRowSelection()
      setOpen(false)
      toast.success(t('history.deleted', { count: ids.length }))
    },
  })

  return (
    <>
      <DataTableBulkActions table={table}>
        <Button variant='destructive' size='sm' onClick={() => setOpen(true)}>
          <Trash2 /> {t('common.delete')}
        </Button>
      </DataTableBulkActions>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('history.deleteTitle')}
        desc={t('history.deleteDesc', { count: ids.length })}
        cancelBtnText={t('common.cancel')}
        confirmText={t('common.delete')}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => remove.mutate()}
      />
    </>
  )
}
