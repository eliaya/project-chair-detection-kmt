import {
  Camera,
  Cpu,
  History,
  LayoutDashboard,
  Monitor,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  SquareDashed,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: '監視',
      items: [
        { title: 'ダッシュボード', url: '/', icon: LayoutDashboard },
        { title: '履歴', url: '/history', icon: History },
      ],
    },
    {
      title: '設定',
      items: [
        { title: 'ゾーン', url: '/zones', icon: SquareDashed },
        { title: 'カメラ', url: '/cameras', icon: Camera },
        { title: 'デバイス', url: '/devices', icon: Cpu },
        { title: '閾値', url: '/thresholds', icon: SlidersHorizontal },
      ],
    },
    {
      title: '管理',
      items: [
        { title: '管理者', url: '/admins', icon: ShieldCheck },
        { title: '外観', url: '/settings/appearance', icon: Palette },
        { title: '表示', url: '/settings/display', icon: Monitor },
      ],
    },
  ],
}
