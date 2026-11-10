// Build da extensão com esbuild. Bundla os TS e copia os arquivos estáticos para dist/.
import { build, context } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    background: 'src/background.ts',
    offscreen: 'src/offscreen.ts',
    popup: 'src/popup/popup.ts',
    'request-mic': 'src/request-mic.ts',
  },
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir,
  sourcemap: true,
  logLevel: 'info',
};

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await Promise.all([
    copyFile('manifest.json', `${outdir}/manifest.json`),
    copyFile('src/offscreen.html', `${outdir}/offscreen.html`),
    copyFile('src/popup/popup.html', `${outdir}/popup.html`),
    copyFile('src/popup/popup.css', `${outdir}/popup.css`),
    copyFile('src/request-mic.html', `${outdir}/request-mic.html`),
    copyFile('assets/icon-128.png', `${outdir}/icon-128.png`),
  ]);
}

if (watch) {
  const ctx = await context(options);
  await ctx.rebuild();
  await copyStatic();
  await ctx.watch();
  console.log('esbuild observando mudanças... (Ctrl+C para sair)');
} else {
  await build(options);
  await copyStatic();
  console.log('Build concluído em dist/. Carregue essa pasta como extensão sem compactação.');
}
