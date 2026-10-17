import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageShell } from '@/components/layout/page-shell'
import { type Field, FieldsForm } from '@/features/resources/fields-form'
import { thresholdsSchema } from '../../../shared/schemas'

const fields: Field[] = [
  { name: 'confidence', label: '検出信頼度 (0〜1)', type: 'number' },
  {
    name: 'confirm_frames',
    label: '着席確定の連続検出回数',
    type: 'number',
    description: '約1回/秒。3なら約3秒で着席。',
  },
  { name: 'leave_grace_s', label: '離席猶予 (秒)', type: 'number' },
  {
    name: 'staff_aspect_ratio',
    label: '店員判定: 縦横比',
    type: 'number',
    description: '現在の main.py では未使用。',
  },
  {
    name: 'staff_speed_px',
    label: '店員判定: 移動速度 (px)',
    type: 'number',
    description: '現在の main.py では未使用。',
  },
]

const queryKey = ['settings', 'thresholds']

export function Thresholds() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get<Record<string, number>>('/settings/thresholds')
        .then((r) => r.data),
  })
  const save = useMutation({
    mutationFn: (values: object) => api.put('/settings/thresholds', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
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
              fields={fields}
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
