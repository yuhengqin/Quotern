import { createFileRoute } from '@tanstack/react-router';
import { AchievementsPage } from '../achievements/AchievementsPage';

export const Route = createFileRoute('/achievements')({ component: AchievementsPage });
