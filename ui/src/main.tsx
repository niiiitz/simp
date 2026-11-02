import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultSimpClient } from '@simp/client';
import { App } from './App';
import { AppleMusicDriver } from './drivers/AppleMusicDriver';

const HeadlessAppleWorker: React.FC = () => {
  useEffect(() => {
    defaultSimpClient.connect();
  }, []);
  return <AppleMusicDriver />;
};

const isDedicatedAppleWorker =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('worker') === 'apple';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      {isDedicatedAppleWorker ? <HeadlessAppleWorker /> : <App />}
    </React.StrictMode>
  );
}

