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

export default defineConfig({
  base: './',
  plugins: [backgroundUploadPlugin()],
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