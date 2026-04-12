import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'fs';
import { extname, join, resolve } from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

/**
 * `modeling/Wani_game.glb` を `public/modeling/` に同期する。
 * Vite は `public/` をそのままルートで配信するため、ミドルウェア順序に依存せず確実に GLB が取れる。
 */
function syncWaniGlbToPublic() {
  return {
    name: 'sync-wani-glb-public',
    buildStart() {
      const root = process.cwd();
      const src = join(root, 'modeling', 'Wani_game.glb');
      const destDir = join(root, 'public', 'modeling');
      const dest = join(destDir, 'Wani_game.glb');
      if (!existsSync(src)) {
        console.warn('[vite] modeling/Wani_game.glb がありません。先に npm run build:model を実行してください。');
        return;
      }
      mkdirSync(destDir, { recursive: true });
      const srcSt = statSync(src);
      let need = true;
      if (existsSync(dest)) {
        const dstSt = statSync(dest);
        need = srcSt.mtimeMs > dstSt.mtimeMs || srcSt.size !== dstSt.size;
      }
      if (need) {
        copyFileSync(src, dest);
        console.info('[vite] public/modeling/Wani_game.glb を同期しました');
      }
    },
  };
}

/**
 * 開発サーバーで `modeling/` を `/modeling/*` として配信する。
 * （public に無いファイル用のフォールバック）
 */
function modelingDevStatic() {
  const modelingRoot = resolve(process.cwd(), 'modeling');
  const mime = {
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return {
    name: 'modeling-dev-static',
    enforce: 'pre',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (!pathname.startsWith('/modeling/')) return next();
        const rel = decodeURIComponent(pathname.slice('/modeling/'.length));
        if (!rel || rel.includes('..')) return next();
        const abs = resolve(modelingRoot, rel);
        if (!abs.startsWith(modelingRoot)) return next();
        if (!existsSync(abs) || !statSync(abs).isFile()) return next();

        const type = mime[extname(rel).toLowerCase()] || 'application/octet-stream';
        const st = statSync(abs);
        res.setHeader('Content-Type', type);
        res.setHeader('Content-Length', String(st.size));
        res.setHeader('Cache-Control', 'no-cache');
        const stream = createReadStream(abs);
        stream.on('error', () => next());
        stream.pipe(res);
      });
    },
  };
}

function copyModelingAssets() {
  return {
    name: 'copy-modeling-assets',
    closeBundle() {
      const root = process.cwd();
      const srcDir = join(root, 'modeling');
      const outDir = join(root, 'dist', 'modeling');
      mkdirSync(outDir, { recursive: true });
      const files = ['Wani_game.glb', 'Wani_game.meta.json', 'viewer.html', 'Walking_wani.glb'];
      for (const f of files) {
        const src = join(srcDir, f);
        if (existsSync(src)) copyFileSync(src, join(outDir, f));
      }
    },
  };
}

export default defineConfig({
  plugins: [basicSsl(), syncWaniGlbToPublic(), modelingDevStatic(), copyModelingAssets()],
  server: {
    host: true,
    https: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/game-api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/game-api/, '/api'),
      },
      '/game-ws': {
        target: 'ws://127.0.0.1:8090',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/game-ws/, '/ws'),
      },
    },
  },
});
