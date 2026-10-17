import { createFileRoute } from '@tanstack/react-router'
import { resources } from '@/features/resources/definitions'
import { ResourcePage } from '@/features/resources/resource-page'

export const Route = createFileRoute('/_authenticated/cameras/')({
  component: () => <ResourcePage def={resources.cameras} />,
})
