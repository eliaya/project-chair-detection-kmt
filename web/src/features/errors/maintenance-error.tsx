import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'

export function MaintenanceError() {
  const { t } = useI18n()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'>503</h1>
        <span className='font-medium'>{t('errorPage.503.title')}</span>
        <p className='max-w-md text-center text-balance text-muted-foreground'>
          {t('errorPage.503.desc')}
        </p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline'>{t('errorPage.learnMore')}</Button>
        </div>
      </div>
    </div>
  )
}
