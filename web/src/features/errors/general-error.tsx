import { useNavigate, useRouter } from '@tanstack/react-router'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
}

export function GeneralError({
  className,
  minimal = false,
}: GeneralErrorProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  const { t } = useI18n()
  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {!minimal && (
          <h1 className='text-[7rem] leading-tight font-bold'>500</h1>
        )}
        <span className='font-medium'>{t('errorPage.500.title')}</span>
        <p className='max-w-md text-center text-balance text-muted-foreground'>
          {t('errorPage.500.desc')}
        </p>
        {!minimal && (
          <div className='mt-6 flex gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              {t('errorPage.goBack')}
            </Button>
            <Button onClick={() => navigate({ to: '/' })}>
              {t('errorPage.home')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
