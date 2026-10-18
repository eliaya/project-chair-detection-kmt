import { AxiosError } from 'axios'
import { t, tr } from '@/i18n'
import { toast } from 'sonner'

export function handleServerError(error: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(error)
  }

  let errMsg = t('error.generic')

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = t('error.noContent')
  }

  if (error instanceof AxiosError) {
    const title = error.response?.data?.title
    if (typeof title === 'string' && title.length > 0) {
      errMsg = tr(title)
    }
  }

  toast.error(errMsg)
}
