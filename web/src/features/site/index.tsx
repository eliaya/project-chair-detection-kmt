import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, siteNameQuery } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageShell } from '@/components/layout/page-shell'
import { FieldsForm } from '@/features/resources/fields-form'
import { siteNameSchema } from '../../../shared/schemas'

export function Site() {
  const queryClient = useQueryClient()
  const { data, isSuccess } = useQuery(siteNameQuery)
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.put('/settings/site_name', values),
    onSuccess: (_, values) => {
      queryClient.setQueryData(siteNameQuery.queryKey, String(values.site_name))
      toast.success('保存しました')
    },
  })

  return (
    <PageShell
      title='サイト'
      description='監視する店舗・施設の名前です。管理画面のサイドバーに表示されます。'
      actions={
        <Button type='submit' form='site-form' disabled={save.isPending}>
          保存
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
                  label: 'サイト名',
                  placeholder: '例: 本店',
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
