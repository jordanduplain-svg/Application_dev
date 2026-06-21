import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Config electron-vite : trois cibles compilées séparément.
//  - main    : process principal Electron (métier, DB, IPC)
//  - preload : pont sécurisé exposé au renderer
//  - renderer: l'interface React
export default defineConfig({
  main: {
    // externalizeDepsPlugin garde les `dependencies` hors du bundle : Prisma,
    // pdf-parse, etc. ont du code natif ou des `require` dynamiques qui ne
    // supportent pas le bundling. electron-builder les copiera tels quels.
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'electron/preload.ts') },
    },
  },
  renderer: {
    // L'UI est une appli Vite classique, racine dans renderer/.
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'renderer/index.html') },
    },
    plugins: [react()],
  },
});
