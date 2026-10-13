export const SHARE_BACKGROUNDS_CHANNEL = 'share-backgrounds:request';
export interface SavedShareBackground {
  id: string;
  name: string;
  image: string;
  createdAt: number;
  lastUsedAt: number;
}
export type ShareBackgroundRequest = { operation: 'legacy' };
