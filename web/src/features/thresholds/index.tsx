import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageShell } from '@/components/layout/page-shell'
import { FieldsForm } from '@/features/resources/fields-form'
import { thresholdsSchema } from '../../../shared/schemas'
import { thresholdFields, thresholdsQuery } from './fields'

export function Thresholds() {
  const queryClient = useQueryClient()
  const { data } = useQuery(thresholdsQuery)
  const save = useMutation({
    mutationFn: (values: object) => api.put('/settings/thresholds', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: thresholdsQuery.queryKey })
      toast.success('保存しました')
    },
  })

  return (
    <PageShell
      title='閾値'
      description='main.py の判定パラメータ。各デバイスは起動時に読み込みます（変更は再起動後に反映）。'
      actions={
        <Button type='submit' form='thresholds-form' disabled={save.isPending}>
          保存
        </Button>
      }
    >
      <Card className='max-w-xl'>
        <CardContent>
          {data && (
            <FieldsForm
              id='thresholds-form'
              fields={thresholdFields}
              schema={thresholdsSchema}
              initial={data}
              onValid={(values) => save.mutate(values)}
            />
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
