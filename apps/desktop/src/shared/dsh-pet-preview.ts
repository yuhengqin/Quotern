export const DSH_PET_PREVIEW_SCHEME = 'quotern-dsh-pet';
export const DSH_PET_PREVIEW_PROTOCOL = {
  scheme: DSH_PET_PREVIEW_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

// Match the other pets' preview states while preserving upstream media names.
export const DSH_PET_PREVIEW_ACTIONS = [
  { name: '用鲸鱼尾巴拍打地面', labelKey: 'desktop.pet.preview.calm' },
  { name: '舞狮头', labelKey: 'desktop.pet.preview.thinking' },
  { name: '原地左转奔跑', labelKey: 'desktop.pet.preview.multitask' },
  { name: '堆雪人', labelKey: 'desktop.pet.preview.continuous' },
  { name: '点击回应-开心跃动', labelKey: 'desktop.pet.preview.celebrate' },
  { name: '哈欠连天', labelKey: 'desktop.pet.preview.rest' },
] as const;

export function dshPetPreviewUrl(name: string): string {
  return `${DSH_PET_PREVIEW_SCHEME}://preview/${encodeURIComponent(name)}.webm`;
}
