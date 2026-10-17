import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { type Field } from '@/features/resources/fields-form'

export const thresholdFields: Field[] = [
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

export const thresholdsQuery = queryOptions({
  queryKey: ['settings', 'thresholds'],
  queryFn: () =>
    api.get<Record<string, number>>('/settings/thresholds').then((r) => r.data),
})
