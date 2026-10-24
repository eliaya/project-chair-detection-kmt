import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { Loader2 } from 'lucide-react'

type LiveState = 'connecting' | 'waiting' | 'no_pi' | 'closed'

// Frames from the Pi, relayed by the Worker (worker/live.ts): the Pi sends a camera's frames
// only while a viewer has it open, about one per second.
export function LiveView({ camera }: { camera: string }) {
  const { t } = useI18n()
  const [src, setSrc] = useState<string>()
  const [state, setState] = useState<LiveState>('connecting')

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(
      `${scheme}://${window.location.host}/api/cameras/${encodeURIComponent(camera)}/live`
    )
    let url: string | undefined
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        setState(JSON.parse(e.data).pi ? 'waiting' : 'no_pi')
        return
      }
      if (url) URL.revokeObjectURL(url)
      url = URL.createObjectURL(new Blob([e.data], { type: 'image/jpeg' }))
      setSrc(url)
    }
    ws.onclose = () => setState('closed')
    return () => {
      ws.onclose = null
      ws.close()
      if (url) URL.revokeObjectURL(url)
    }
  }, [camera])

  const message =
    state === 'no_pi' || state === 'closed' ? t(`live.${state}`) : undefined
  return (
    <div className='flex flex-col gap-3'>
      {src && !message ? (
        <img src={src} alt={camera} className='w-full rounded-md bg-muted' />
      ) : (
        <div className='flex aspect-video w-full items-center justify-center gap-2 rounded-md bg-muted p-6 text-sm text-muted-foreground'>
          {!message && <Loader2 className='size-4 animate-spin' />}
          {message ?? t('live.waiting')}
        </div>
      )}
    </div>
  )
}
