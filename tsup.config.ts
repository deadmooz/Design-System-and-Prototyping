import { defineConfig } from 'tsup';

// Builds only the optional React component package. The engine, server and CLI
// run directly on Node's native TypeScript support and need no build step.
export default defineConfig({
  entry: { index: 'src/react/index.ts' },
  outDir: 'dist/react',
  format: ['esm', 'cjs'],
  dts: { compilerOptions: { allowImportingTsExtensions: true } },
  sourcemap: false,
  clean: true,
  external: ['react', 'react-dom'],
  injectStyle: false,
});
