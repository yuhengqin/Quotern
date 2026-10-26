import { createFileRoute } from '@tanstack/react-router';
import { BillingPage } from '../pages/BillingPage';
export const Route = createFileRoute('/billing')({ component: BillingPage });
