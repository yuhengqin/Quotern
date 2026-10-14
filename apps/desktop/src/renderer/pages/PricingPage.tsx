import { PricingPage as SharedPricingPage } from '../../../../../packages/dashboard/src/pages/PricingPage';
import { fetchModelBreakdown } from '../lib/api';

export function PricingPage() {
  return <SharedPricingPage loadUsage={fetchModelBreakdown} />;
}
