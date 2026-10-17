import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  const handleSignOut = async () => {
    // Clear local state even if the request fails; the cookie expires anyway.
    await api.post('/auth/logout').catch(() => {})
    // Preserve current location for redirect after sign-in
    const currentPath = location.href
    await navigate({
      to: '/sign-in',
      search: { redirect: currentPath },
      replace: true,
    })
    queryClient.clear()
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='ログアウト'
      desc='ログアウトしますか？'
      cancelBtnText='キャンセル'
      confirmText='ログアウト'
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
