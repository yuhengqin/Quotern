import { PricingPage as SharedPricingPage } from '../../../../../packages/dashboard/src/pages/PricingPage';
import { fetchModelBreakdown, fetchPricingCatalog } from '../lib/api';

export function PricingPage() {
  return <SharedPricingPage loadUsage={fetchModelBreakdown} loadCatalog={fetchPricingCatalog} />;
}
