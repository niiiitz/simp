import React from 'react';
import { useAppleMusicWorker } from './appleWorker';

export * from './appleApi';
export * from './appleWorker';

/**
 * Headless `<AppleMusicDriver />` Virtual Sink Bridge.
 * Delegates REST catalog/library operations to `appleApi.ts` (and Rust `/api/apple/...` endpoints)
 * and EME playback orchestration to `appleWorker.ts`.
 */
export const AppleMusicDriver: React.FC = () => {
  useAppleMusicWorker();
  return null;
};
