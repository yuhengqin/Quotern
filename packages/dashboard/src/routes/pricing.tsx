import { createFileRoute } from '@tanstack/react-router';
import { PricingPage } from '@/pages/PricingPage';
import { parsePricingSearch } from '../lib/pricing-selection';

export const Route = createFileRoute('/pricing')({
  validateSearch: parsePricingSearch,
  component: PricingPage,
});
