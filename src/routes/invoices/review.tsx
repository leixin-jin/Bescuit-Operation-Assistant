import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/invoices/review')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/invoices/review') {
      throw redirect({ to: '/invoices/new' })
    }
  },
  component: () => <Outlet />,
})
