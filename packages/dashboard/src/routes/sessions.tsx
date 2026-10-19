import { createFileRoute } from '@tanstack/react-router';
import { SessionsPage } from '../pages/SessionsPage';
import { parseSessionPageSearch } from '../lib/session-page';

export const Route = createFileRoute('/sessions')({
  validateSearch: parseSessionPageSearch,
  component: SessionsPage,
});
