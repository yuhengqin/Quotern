import { useAchievements } from './AchievementProvider';
import { DeferredContent } from '../components/DeferredContent';

const loadOverlays = () => import('./AchievementOverlays').then(module => module.AchievementOverlays);

export function DeferredAchievementOverlays() {
  const { detailIds, familyDetail, shareSelection, closeDetails, closeFamily, closeShare } = useAchievements();
  return detailIds.length || familyDetail || shareSelection
    ? <DeferredContent load={loadOverlays} componentProps={{}} onPendingClose={() => { closeDetails(); closeFamily(); closeShare(); }} /> : null;
}
