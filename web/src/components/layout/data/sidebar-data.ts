import {
  Camera,
  Cpu,
  History,
  LayoutDashboard,
  MapIcon,
  Monitor,
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
        { title: 'nav.dashboard', url: '/', icon: LayoutDashboard },
        { title: 'nav.history', url: '/history', icon: History },
      ],
    },
    {
      title: 'nav.setup',
      items: [
        { title: 'nav.floorplan', url: '/floorplan', icon: MapIcon },
        { title: 'nav.zones', url: '/zones', icon: SquareDashed },
        { title: 'nav.cameras', url: '/cameras', icon: Camera },
        { title: 'nav.devices', url: '/devices', icon: Cpu },
        {
          title: 'nav.thresholds',
          url: '/thresholds',
          icon: SlidersHorizontal,
        },
      ],
    },
    {
      title: 'nav.administration',
      items: [
        { title: 'nav.site', url: '/site', icon: Store },
        { title: 'nav.admins', url: '/admins', icon: ShieldCheck },
        { title: 'nav.appearance', url: '/settings/appearance', icon: Palette },
        { title: 'nav.display', url: '/settings/display', icon: Monitor },
      ],
    },
  ],
}
