import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';

import { miaodaDevPlugin } from "miaoda-sc-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all envs regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  // 部署在子路径（如 https://ai.haoxinqing.cn/mindcareai/）时，通过 VITE_BASE_PATH=/mindcareai/ 覆盖
  // 统一规范为前后均带斜杠的形式，与 import.meta.env.BASE_URL 保持一致
  const base = `/${(env.VITE_BASE_PATH || '').replace(/^\/+|\/+$/g, '')}/`.replace(/\/+/g, '/');
  // 前端以 `${BASE_URL}innerapi/...` 请求，开发态代理中间件需挂载在同一前缀下
  const innerApiPrefix = `${base}innerapi/v1`;

  return {
    base,
    publicDir: 'public',
    // 开发服务器：容器内监听 0.0.0.0，并允许经反向代理域名访问
    server: {
      host: '0.0.0.0',
      port: 5173,
      // Vite 默认拦截未知 Host；.haoxinqing.cn 可匹配其全部子域名
      // 需追加其它域名时在 .env 中配置 VITE_ALLOWED_HOSTS（逗号分隔）
      allowedHosts: [
        '.haoxinqing.cn',
        'localhost',
        '.localhost',
        ...(env.VITE_ALLOWED_HOSTS || '').split(','),
      ]
        .map((host) => host.trim())
        .filter(Boolean),
      // 经 HTTPS 反向代理访问时，HMR 需走 wss 且连到代理对外端口
      // 如 .env 配置 VITE_HMR_PROTOCOL=wss、VITE_HMR_CLIENT_PORT=443
      hmr: env.VITE_HMR_PROTOCOL
        ? {
            protocol: env.VITE_HMR_PROTOCOL as 'ws' | 'wss',
            clientPort: Number(env.VITE_HMR_CLIENT_PORT || 443),
          }
        : undefined,
    },
    plugins: [
      react(),
      svgr({
        svgrOptions: {
          icon: true, exportType: 'named', namedExport: 'ReactComponent',
        },
      }),
      (miaodaDevPlugin() as any),
      {
        name: 'modelscope-intern-proxy',
        configureServer(server: any) {
          server.middlewares.use(`${innerApiPrefix}/modelscope/chat/completions`, async (req: any, res: any) => {
            const key = env.MODELSCOPE_API_KEY || env.VITE_MODELSCOPE_API_KEY || '';
            console.log(`[ModelScope Proxy] Request received. Key length: ${key.length}`);
            if (!key) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'MODELSCOPE_API_KEY 未配置' }));
              return;
            }
            try {
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                req.on('data', (c: any) => chunks.push(Buffer.from(c)));
                req.on('end', () => resolve());
                req.on('error', reject);
              });
              const body = chunks.length ? Buffer.concat(chunks).toString('utf-8') : '{}';
              const upstream = await fetch('https://api-inference.modelscope.cn/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${key.trim()}`,
                  'X-Modelscope-Token': key.trim(),
                  'Content-Type': 'application/json',
                  'Accept': 'application/json, text/event-stream'
                },
                body
              });

              res.statusCode = upstream.status;
              res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');

              if (upstream.body) {
                const reader = upstream.body.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
                }
              }
              res.end();
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err?.message || err) }));
            }
          });
        }
      },
      {
        name: 'volc-ark-responses-proxy',
        configureServer(server: any) {
          server.middlewares.use(`${innerApiPrefix}/volc/responses`, async (req: any, res: any) => {
            const key = env.VOLC_ARK_API_KEY || env.VITE_VOLC_ARK_API_KEY || '';
            if (!key) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'VOLC_ARK_API_KEY 未配置' }));
              return;
            }
            try {
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                req.on('data', (c: any) => chunks.push(Buffer.from(c)));
                req.on('end', () => resolve());
                req.on('error', reject);
              });
              const body = chunks.length ? Buffer.concat(chunks).toString('utf-8') : '{}';
              const upstream = await fetch('https://ark.cn-beijing.volces.com/api/v3/responses', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${key}`,
                  'Content-Type': 'application/json'
                },
                body
              });
              
              res.statusCode = upstream.status;
              res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');

              if (upstream.body) {
                const reader = upstream.body.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
                }
              }
              res.end();
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err?.message || err) }));
            }
          });
        }
      },
      {
        name: 'siliconflow-audio-proxy',
        configureServer(server: any) {
          server.middlewares.use(`${innerApiPrefix}/siliconflow/audio/transcriptions`, async (req: any, res: any) => {
            const key = env.SILICONFLOW_API_KEY || env.VITE_SILICONFLOW_API_KEY || '';
            if (!key) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'SILICONFLOW_API_KEY 未配置' }));
              return;
            }
            try {
              // Forward the multipart/form-data request
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                req.on('data', (c: any) => chunks.push(Buffer.from(c)));
                req.on('end', () => resolve());
                req.on('error', reject);
              });
              const body = Buffer.concat(chunks);
              
              const upstream = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${key}`,
                  'Content-Type': req.headers['content-type'] || 'multipart/form-data',
                },
                body
              });
              
              const text = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(text);
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err?.message || err) }));
            }
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
