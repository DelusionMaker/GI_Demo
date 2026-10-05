import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import glsl from 'vite-plugin-glsl'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    // 着色器源文件以 `#version 100` 开头（供 glslangValidator 按 GLSL ES 校验），
    // 但 three 会在源码前插入 `#define SHADER_TYPE` / `#define SHADER_NAME`，
    // 使 `#version` 不再位于首行而编译失败。这里在打包时剥掉首行 `#version`，
    // three 在 WebGL2 下遇到"无 #version"的着色器会默认按 GLSL ES 1.00 编译，行为不变。
    glsl({
      onComplete: (shader) => shader.replace(/^#version[^\n]*\n/, ''),
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: true,
  },
})
