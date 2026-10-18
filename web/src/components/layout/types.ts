import { type LinkProps } from '@tanstack/react-router'
import { type Key } from '@/i18n'

type BaseNavItem = {
  title: Key
  badge?: string
  icon?: React.ElementType
}

type NavLink = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
  items?: never
}

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: LinkProps['to'] | (string & {}) })[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type NavGroup = {
  title: Key
  items: NavItem[]
}

type SidebarData = {
  navGroups: NavGroup[]
}

export type { SidebarData, NavGroup, NavItem, NavCollapsible, NavLink }
