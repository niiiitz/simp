import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultSimpClient } from '@simp/client';
import { App } from './App';
import { AppleMusicDriver } from './drivers/AppleMusicDriver';

const isDedicatedAppleWorker =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('worker') === 'apple' ||
    window.location.pathname.startsWith('/apple-worker'));

if (isDedicatedAppleWorker && typeof document !== 'undefined') {
  document.title = 'SIMP Headless Audio Worker';
}

const HeadlessAppleWorker: React.FC = () => {
  useEffect(() => {
    document.title = 'SIMP Headless Audio Worker';
    defaultSimpClient.connect();
  }, []);
  return <AppleMusicDriver />;
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      {isDedicatedAppleWorker ? <HeadlessAppleWorker /> : <App />}
    </React.StrictMode>
  );
}

