import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ClientStore, type KeyValueStorage } from './state/store.js';
import { defaultWsUrl } from './net/socket.js';
import './styles.css';

function safeStorage(): KeyValueStorage | null {
  try {
    const k = '__civwar_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

const store = new ClientStore(defaultWsUrl(), safeStorage());
// 개발 빌드: 매 룸 snapshot_full 직전에 리듀서 상태와 비교 (window.__civwar.reconStats)
store.reconCheck = import.meta.env.DEV;
(window as unknown as { __civwar: ClientStore }).__civwar = store;
store.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
