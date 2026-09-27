import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: (env) => ({
    name: 'readhd 阅读助手',
    description: '帮助有阅读困难的孩子更轻松地阅读中文网页',
    permissions: ['storage', 'activeTab'],
    host_permissions: [
      'https://api.minimax.cn/*',
      'https://api.minimax.io/*',
      'https://api.deepseek.com/*',
      'https://dashscope.aliyuncs.com/*',
      // Dev only: local mock provider for the e2e suite.
      ...(env.mode === 'development'
        ? ['http://127.0.0.1/*', 'http://localhost/*']
        : []),
    ],
    optional_host_permissions: ['https://*/*'],
    commands: {
      'toggle-reader': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: '切换阅读模式',
      },
    },
  }),
  vite: (env) => ({
    define: {
      // Dev-only fallback API key; production builds always get an empty string.
      'process.env.MINIMAX_API_KEY': JSON.stringify(
        env.mode === 'development' ? (process.env.MINIMAX_API_KEY ?? '') : '',
      ),
    },
  }),
});
