import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
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
  const { t } = useI18n()
  const { data } = useQuery(thresholdsQuery)
  const save = useMutation({
    mutationFn: (values: object) => api.put('/settings/thresholds', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: thresholdsQuery.queryKey })
      toast.success(t('common.saved'))
    },
  })

  return (
    <PageShell
      title={t('nav.thresholds')}
      description={t('thresholds.desc')}
      actions={
        <Button type='submit' form='thresholds-form' disabled={save.isPending}>
          {t('common.save')}
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
