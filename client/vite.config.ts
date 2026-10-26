import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
/** 게임 서버 (npm run start:server, 기본 8080). CIVWAR_SERVER 로 변경 */
const target = process.env.CIVWAR_SERVER ?? 'ws://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // @civwar/shared 는 빌드 없이 TS 소스(../shared/src)를 직접 쓴다 (프로토콜 문서 §1)
    fs: { allow: [repoRoot] },
    proxy: {
      '/ws': { target, ws: true, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/ws': { target, ws: true, changeOrigin: true },
    },
  },
});
