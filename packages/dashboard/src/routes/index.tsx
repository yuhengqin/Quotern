import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => {
    // Preserve query parameters and let the router apply the deployment basepath.
    const search = Object.fromEntries(new URLSearchParams(location.searchStr));
    throw redirect({
      to: '/dashboard',
      replace: true,
      search: search as never,
    });
  },
});
