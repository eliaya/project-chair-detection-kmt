import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { type Field } from '@/features/resources/fields-form'

export const thresholdFields: Field[] = [
  { name: 'confidence', label: 'thresholds.confidence', type: 'number' },
  {
    name: 'confirm_frames',
    label: 'thresholds.confirmFrames',
    type: 'number',
    description: 'thresholds.confirmFramesHint',
  },
  { name: 'leave_grace_s', label: 'thresholds.leaveGrace', type: 'number' },
  {
    name: 'staff_aspect_ratio',
    label: 'thresholds.staffAspect',
    type: 'number',
    description: 'thresholds.staffAspectHint',
  },
  {
    name: 'staff_speed_px',
    label: 'thresholds.staffSpeed',
    type: 'number',
    description: 'thresholds.staffSpeedHint',
  },
]

export const thresholdsQuery = queryOptions({
  queryKey: ['settings', 'thresholds'],
  queryFn: () =>
    api.get<Record<string, number>>('/settings/thresholds').then((r) => r.data),
})
