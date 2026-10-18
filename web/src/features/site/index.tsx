import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { toast } from 'sonner'
import { api, siteNameQuery } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageShell } from '@/components/layout/page-shell'
import { FieldsForm } from '@/features/resources/fields-form'
import { siteNameSchema } from '../../../shared/schemas'

export function Site() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const { data, isSuccess } = useQuery(siteNameQuery)
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.put('/settings/site_name', values),
    onSuccess: (_, values) => {
      queryClient.setQueryData(siteNameQuery.queryKey, String(values.site_name))
      toast.success(t('common.saved'))
    },
  })

  return (
    <PageShell
      title={t('nav.site')}
      description={t('site.desc')}
      actions={
        <Button type='submit' form='site-form' disabled={save.isPending}>
          {t('common.save')}
        </Button>
      }
    >
      <Card className='max-w-xl'>
        <CardContent>
          {isSuccess && (
            <FieldsForm
              id='site-form'
              fields={[
                {
                  name: 'site_name',
                  label: 'site.name',
                  placeholder: 'site.namePlaceholder',
                },
              ]}
              schema={siteNameSchema}
              initial={{ site_name: data }}
              onValid={(values) => save.mutate(values)}
            />
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
