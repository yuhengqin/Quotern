import { createFileRoute } from '@tanstack/react-router';
import { PerformancePage } from '../../../../../packages/dashboard/src/pages/PerformancePage';
import { parsePerformanceSearch } from '../../../../../packages/dashboard/src/lib/performance-page';
export const Route = createFileRoute('/performance')({ validateSearch: parsePerformanceSearch, component: PerformancePage });
