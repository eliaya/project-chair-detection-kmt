import { useState } from 'react'
import { useI18n } from '@/i18n'

// The Pi's own MJPEG stream (main.py /live), loaded by the browser straight from the Pi, so it
// shows only on the store LAN (the Pi also refuses other addresses). On an HTTPS admin UI,
// Chrome asks once for local network access; browsers that block it still open the Pi's page.
export function LiveView({
  camera,
  device,
  lanUrl,
}: {
  camera: string
  device: string
  lanUrl: string
}) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  if (!lanUrl)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('live.noUrl', { device })}
      </p>
    )
  return (
    <div className='flex flex-col gap-3'>
      {failed ? (
        <p className='rounded-md bg-muted p-3 text-sm'>
          {t('live.failed', { url: lanUrl })}
        </p>
      ) : (
        <img
          src={`${lanUrl}/live/stream?cam=${encodeURIComponent(camera)}`}
          alt={camera}
          className='w-full rounded-md bg-muted'
          onError={() => setFailed(true)}
        />
      )}
      <a
        href={`${lanUrl}/live`}
        target='_blank'
        rel='noreferrer'
        className='text-sm underline underline-offset-4'
      >
        {t('live.openPi')}
      </a>
    </div>
  )
}
