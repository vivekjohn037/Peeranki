import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function backgroundUploadPlugin(): Plugin {
  return {
    name: 'background-upload-plugin',
    configureServer(server) {
      server.middlewares.use('/api/upload-bg', (req, res) => {
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const targetDir = path.resolve(process.cwd(), 'public/assets/background');
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            const targetFile = path.join(targetDir, 'menu_background.png');
            fs.writeFileSync(targetFile, buffer);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, file: 'menu_background.png', size: buffer.length }));
          });
          req.on('error', (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
    },
  };
}

function cloudflareAssetGuardPlugin(): Plugin {
  return {
    name: 'cloudflare-asset-guard-plugin',
    buildStart() {
      // Clean up any stale oversized WAV or conflicting _redirects from public directory
      const publicWav = path.resolve(process.cwd(), 'public/assets/audio/bg_music.wav');
      if (fs.existsSync(publicWav)) {
        try {
          fs.unlinkSync(publicWav);
          console.log('[Cloudflare Guard] Removed stale public/assets/audio/bg_music.wav');
        } catch {}
      }
      const publicRedirects = path.resolve(process.cwd(), 'public/_redirects');
      if (fs.existsSync(publicRedirects)) {
        try {
          fs.unlinkSync(publicRedirects);
          console.log('[Cloudflare Guard] Removed conflicting public/_redirects');
        } catch {}
      }
    },
    closeBundle() {
      const distDir = path.resolve(process.cwd(), 'dist');
      if (!fs.existsSync(distDir)) return;

      // 1. Ensure bg_music.wav and conflicting _redirects never end up in dist
      const distWav = path.join(distDir, 'assets/audio/bg_music.wav');
      if (fs.existsSync(distWav)) {
        fs.unlinkSync(distWav);
        console.log('[Cloudflare Guard] Purged dist/assets/audio/bg_music.wav');
      }
      const distRedirects = path.join(distDir, '_redirects');
      if (fs.existsSync(distRedirects)) {
        fs.unlinkSync(distRedirects);
        console.log('[Cloudflare Guard] Purged conflicting dist/_redirects');
      }

      // 2. Validate all output files strictly comply with Cloudflare Pages 25 MiB asset limit
      const maxLimitBytes = 25 * 1024 * 1024;
      function checkDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            checkDir(fullPath);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            if (stat.size >= maxLimitBytes) {
              const rel = path.relative(process.cwd(), fullPath);
              const mib = (stat.size / (1024 * 1024)).toFixed(2);
              throw new Error(`[Cloudflare Guard] Asset exceeds Cloudflare Pages 25 MiB limit: ${rel} (${mib} MiB)`);
            }
          }
        }
      }
      checkDir(distDir);
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || (process.env.ELECTRON === 'true' ? './' : '/'),
  plugins: [backgroundUploadPlugin(), cloudflareAssetGuardPlugin()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) {
            return 'vendor-phaser';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'vendor-supabase';
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});