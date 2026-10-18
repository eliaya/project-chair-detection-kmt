import { useI18n } from '@/i18n'
import { CircleAlert, CircleCheck, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type Health } from '../../../shared/schemas'

// Statuses are judged by the Worker (worker/index.ts deviceStatus / cameraStatus).
export type DeviceStatus =
  'not_connected' | 'starting' | 'online' | 'offline' | 'camera_error'
export type CameraStatus =
  'ok' | 'open_failed' | 'read_failed' | 'not_reported' | 'offline'

export type Device = {
  id: string
  last_seen_at: string | null
  config_fetched_at: string | null
  health: Health | null
  status: DeviceStatus
}

const tone: Record<DeviceStatus | CameraStatus, string> = {
  online: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  starting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  not_reported: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  camera_error: 'bg-red-500/15 text-red-700 dark:text-red-300',
  open_failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  read_failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  offline: 'bg-muted text-muted-foreground',
  not_connected: 'bg-muted text-muted-foreground',
}

export function DeviceBadge({ status }: { status: DeviceStatus }) {
  const { t } = useI18n()
  return (
    <Badge variant='outline' className={cn('border-transparent', tone[status])}>
      {t(`deviceStatus.${status}`)}
    </Badge>
  )
}

export function CameraBadge({ status }: { status: CameraStatus }) {
  const { t } = useI18n()
  return (
    <Badge variant='outline' className={cn('border-transparent', tone[status])}>
      {t(`cameraStatus.${status}`)}
    </Badge>
  )
}

// ISO timestamps from the Worker: the later of the two compares greater.
const lastContact = (d: Device) =>
  [d.last_seen_at ?? '', d.config_fetched_at ?? ''].sort()[1]

// Shown with a new or re-issued token: what to put on the Pi, then whether it connected.
// "Connected" means the Pi made contact after the token was issued (Worker timestamps).
export function DeviceConnection({
  token,
  issued,
  current,
}: {
  token: string
  issued: Device
  current?: Device
}) {
  const { t } = useI18n()
  const env = `API_TOKEN=${token}\nCONFIG_URL=${window.location.origin}/api/config`
  const connected = current && lastContact(current) > lastContact(issued)
  const badCameras = Object.entries(current?.health?.cameras ?? {})
    .filter(([, s]) => s !== 'ok')
    .map(([id, s]) => `${id}: ${t(`cameraStatus.${s}`)}`)
    .join(', ')

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-start gap-2'>
        <pre className='min-w-0 flex-1 rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap select-all'>
          {env}
        </pre>
        <Button
          variant='outline'
          size='icon'
          aria-label={t('common.copy')}
          onClick={() =>
            navigator.clipboard
              .writeText(env)
              .then(() => toast.success(t('common.copied')))
          }
        >
          <Copy />
        </Button>
      </div>
      <div aria-live='polite' className='flex items-start gap-2 text-sm'>
        {!connected ? (
          <>
            <Loader2 className='mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground' />
            <div>
              <p>{t('connect.waiting')}</p>
              <p className='text-xs text-muted-foreground'>
                {t('connect.hint')}
              </p>
            </div>
          </>
        ) : current.status === 'camera_error' ? (
          <>
            <CircleAlert className='mt-0.5 size-4 shrink-0 text-red-600' />
            <p>{t('connect.cameraError', { cameras: badCameras })}</p>
          </>
        ) : current.status === 'online' ? (
          <>
            <CircleCheck className='mt-0.5 size-4 shrink-0 text-emerald-600' />
            <p>{t('connect.online')}</p>
          </>
        ) : (
          <>
            <Loader2 className='mt-0.5 size-4 shrink-0 animate-spin text-amber-600' />
            <p>{t('connect.starting')}</p>
          </>
        )}
      </div>
    </div>
  )
}
