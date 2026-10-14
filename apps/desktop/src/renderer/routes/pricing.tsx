import { createFileRoute } from '@tanstack/react-router';
import { PricingPage } from '../pages/PricingPage';

export const Route = createFileRoute('/pricing')({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
  }),
  component: PricingPage,
});
