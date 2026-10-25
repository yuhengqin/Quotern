/** Shared browser components retain normal native behavior; Desktop has no demo entry. */
export const isDemoMode = () => false;
export const dashboardNow = () => new Date();
export const demoStorageKey = (key: string) => key;
