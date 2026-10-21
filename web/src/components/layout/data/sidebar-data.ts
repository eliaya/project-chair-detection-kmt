import {
  Camera,
  Cpu,
  History,
  LayoutDashboard,
  MapIcon,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  SquareDashed,
  Store,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: 'nav.monitoring',
      items: [
        { title: 'nav.dashboard', url: '/admin', icon: LayoutDashboard },
        { title: 'nav.history', url: '/admin/history', icon: History },
      ],
    },
    {
      title: 'nav.setup',
      items: [
        { title: 'nav.floorplan', url: '/admin/floorplan', icon: MapIcon },
        { title: 'nav.zones', url: '/admin/zones', icon: SquareDashed },
        { title: 'nav.cameras', url: '/admin/cameras', icon: Camera },
        { title: 'nav.devices', url: '/admin/devices', icon: Cpu },
        {
          title: 'nav.thresholds',
          url: '/admin/thresholds',
          icon: SlidersHorizontal,
        },
      ],
    },
    {
      title: 'nav.administration',
      items: [
        { title: 'nav.site', url: '/admin/site', icon: Store },
        { title: 'nav.admins', url: '/admin/admins', icon: ShieldCheck },
        {
          title: 'nav.appearance',
          url: '/admin/settings/appearance',
          icon: Palette,
        },
      ],
    },
  ],
}
