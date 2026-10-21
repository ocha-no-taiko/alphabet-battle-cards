import { defineConfig } from "vite";

// 相対パスで出力して、GitHub Pages のサブパスや file 配信でも動くようにする
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
