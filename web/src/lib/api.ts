import axios from 'axios'
import { queryOptions } from '@tanstack/react-query'

// Same-origin Worker API; the session is an HttpOnly cookie set by /api/auth/login.
export const api = axios.create({ baseURL: '/api' })

export type Me = { id: number; email: string; name: string }

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api.get<Me>('/auth/me').then((r) => r.data),
  staleTime: Infinity,
  retry: false,
})

export const listQuery = <T>(key: string) =>
  queryOptions({
    queryKey: [key],
    queryFn: () => api.get<T[]>(`/${key}`).then((r) => r.data),
  })
