import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'fs';
import { extname, join, resolve } from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/** game backend 未起動時の ECONNREFUSED を、約 8 秒に 1 回まで日本語で案内（ログスパム抑制） */
function proxyWarnIfBackendDown(proxy, label) {
  let last = 0;
  proxy.on('error', (err) => {
    if (!err || err.code !== 'ECONNREFUSED') return;
    const now = Date.now();
    if (now - last < 8000) return;
    last = now;
    console.warn(
      `\n[vite] ${label}: 127.0.0.1:8090 に接続できません（game backend 未起動）。\n` +
        '    別ターミナルで npm run dev:game-backend または npm run dev:all を起動してください。\n',
    );
  });
}

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

/** 開発時・本番ビルドで `medea-pipeline/collect.html` 等を `/medea-pipeline/*` で配信 */
function medeaPipelineStatic() {
  const medeaRoot = resolve(process.cwd(), 'medea-pipeline');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  return {
    name: 'medea-pipeline-static',
    enforce: 'pre',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (!pathname.startsWith('/medea-pipeline/')) return next();
        const rel = decodeURIComponent(pathname.slice('/medea-pipeline/'.length));
        if (!rel || rel.includes('..')) return next();
        const abs = resolve(medeaRoot, rel);
        if (!abs.startsWith(medeaRoot)) return next();
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

function copyMedeaPipelineToDist() {
  return {
    name: 'copy-medea-pipeline-dist',
    closeBundle() {
      const root = process.cwd();
      const srcDir = join(root, 'medea-pipeline');
      const outDir = join(root, 'dist', 'medea-pipeline');
      if (!existsSync(srcDir)) return;
      mkdirSync(outDir, { recursive: true });
      for (const f of ['collect.html']) {
        const src = join(srcDir, f);
        if (existsSync(src)) copyFileSync(src, join(outDir, f));
      }
    },
  };
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['game/frontend/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage/frontend',
      include: ['game/frontend/src/**/*.{ts,tsx,vue}'],
      exclude: ['game/frontend/src/**/*.test.ts', 'game/frontend/src/env.d.ts'],
    },
  },
  plugins: [
    vue(),
    basicSsl(),
    syncWaniGlbToPublic(),
    modelingDevStatic(),
    medeaPipelineStatic(),
    copyModelingAssets(),
    copyMedeaPipelineToDist(),
  ],
  server: {
    host: true,
    https: true,
    proxy: {
      '/game-api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/game-api/, '/api'),
        configure: (proxy) => proxyWarnIfBackendDown(proxy, 'proxy /game-api →'),
      },
      '/game-ws': {
        target: 'ws://127.0.0.1:8090',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/game-ws/, '/ws'),
        configure: (proxy) => proxyWarnIfBackendDown(proxy, 'proxy /game-ws →'),
      },
    },
  },
});
