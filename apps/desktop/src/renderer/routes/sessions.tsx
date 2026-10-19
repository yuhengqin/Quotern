import { createFileRoute } from '@tanstack/react-router';
import { SessionsPage } from '../../../../../packages/dashboard/src/pages/SessionsPage';
import { parseSessionPageSearch } from '../../../../../packages/dashboard/src/lib/session-page';

export const Route = createFileRoute('/sessions')({
  validateSearch: parseSessionPageSearch,
  component: SessionsPage,
});
