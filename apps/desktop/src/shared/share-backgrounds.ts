export const SHARE_BACKGROUNDS_CHANNEL = 'share-backgrounds:request';
export interface SavedShareBackground {
  id: string;
  name: string;
  image: string;
  createdAt: number;
  lastUsedAt: number;
}
export type ShareBackgroundRequest =
  | { operation: 'list' }
  | { operation: 'add'; input: { name: string; image: string }; replaceId?: string }
  | { operation: 'remove' | 'touch'; id: string };
