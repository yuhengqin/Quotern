export const DSH_PET_PREVIEW_SCHEME = 'quotern-dsh-pet';
export const DSH_PET_PREVIEW_PROTOCOL = {
  scheme: DSH_PET_PREVIEW_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

// Keep the upstream animation names for playback; only shorten the visible label.
export const DSH_PET_PREVIEW_ACTIONS = [
  { name: '舞狮头', label: '舞狮头' },
  { name: '点击回应-开心跃动', label: '开心跃动' },
  { name: '原地左转奔跑', label: '原地左转奔跑' },
  { name: '哈欠连天', label: '哈欠连天' },
  { name: '用鲸鱼尾巴拍打地面', label: '用鲸鱼尾巴拍打地面' },
  { name: '堆雪人', label: '堆雪人' },
] as const;

export function dshPetPreviewUrl(name: string): string {
  return `${DSH_PET_PREVIEW_SCHEME}://preview/${encodeURIComponent(name)}.webm`;
}
