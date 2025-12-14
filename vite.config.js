import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 按需引入插件
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
// Element Plus 解析器
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // 自动导入 Element Plus 相关 API（如 ElMessage、ElMessageBox 等）
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    // 自动导入 Element Plus 组件（如 el-row、el-col）
    Components({
      resolvers: [
        // 自动引入组件和对应的样式（默认引入 CSS 样式，若需 SCSS 需额外配置）
        ElementPlusResolver({
          // 关键：告诉 ElementPlusResolver 同时解析图标
          importStyle: 'css',
          // 指明图标的位置
          icons: 'svg',
        }),
      ],
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@pdfium': fileURLToPath(new URL('./src/libs/pdfium', import.meta.url))
    },
  },
  optimizeDeps: {
    exclude: ['/pdfium/pdfium.esm.js'] // 不优化 PDFium 模块
  },
  assetsInclude: ['**/*.wasm'], // 识别 Wasm 为静态资源
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // 将 wasm 资源单独打包
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.wasm')) {
            return 'assets/[name]-[hash][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
})
