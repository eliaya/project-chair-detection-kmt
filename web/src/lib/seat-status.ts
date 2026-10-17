import { type SeatStatus } from '../../shared/schemas'

export type TableStatus = SeatStatus | 'unknown'

export const seatStatusLabel: Record<TableStatus, string> = {
  empty: '空席',
  confirming: '確認中',
  occupied: '利用中',
  leave_confirm: '離席確認',
  unknown: '不明',
}
