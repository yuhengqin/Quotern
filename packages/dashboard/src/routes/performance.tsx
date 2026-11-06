import { createFileRoute } from '@tanstack/react-router';
import { PerformancePage } from '../pages/PerformancePage';
import { parsePerformanceSearch } from '../lib/performance-page';
export const Route = createFileRoute('/performance')({ validateSearch: parsePerformanceSearch, component: PerformancePage });
