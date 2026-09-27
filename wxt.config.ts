import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'readhd 阅读助手',
    description: '帮助有阅读困难的孩子更轻松地阅读中文网页',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://api.minimax.cn/*'],
  },
  vite: (env) => ({
    define: {
      // Dev-only fallback API key; production builds always get an empty string.
      'process.env.MINIMAX_API_KEY': JSON.stringify(
        env.mode === 'development' ? (process.env.MINIMAX_API_KEY ?? '') : '',
      ),
    },
  }),
});
