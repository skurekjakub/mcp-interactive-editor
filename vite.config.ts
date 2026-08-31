import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The View ships as one HTML file with every byte inlined. It has to: the host
 * serves it into a sandboxed iframe with a CSP that allows no external origins,
 * so a separate .js bundle would simply never load.
 */
export default defineConfig({
  root: "ui",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
