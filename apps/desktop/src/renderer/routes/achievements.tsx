import { createFileRoute } from '@tanstack/react-router';
import { AchievementsPage } from '../pages/AchievementsPage';

export const Route = createFileRoute('/achievements')({ component: AchievementsPage });
