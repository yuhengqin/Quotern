import { createFileRoute } from '@tanstack/react-router';
import { BillingPage } from '../../../../../packages/dashboard/src/pages/BillingPage';
import { fetchBillingReport } from '../lib/api';
export const Route = createFileRoute('/billing')({ component: () => <BillingPage loadReport={fetchBillingReport} /> });
