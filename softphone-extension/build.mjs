// Build da extensão com esbuild. Bundla os TS e copia os arquivos estáticos para dist/.
//
// Os ENDEREÇOS são definidos aqui, no build (a extensão não tem tela de conectividade):
//
//   npm run build -- --backend=https://177.93.130.128 --pbx=https://comunic.ras.yeastar.com
//
// ou pelas variáveis BACKEND_URL / PBX_URL. --pbx aceita vários, separados por vírgula.
// O manifest de dist/ sai com esses endereços em host_permissions (sem pedido de
// permissão ao usuário) e o backend em externally_connectable (ponte com o painel).
// O manifest base já traz *.wts.chat e *.flw.chat: o webRequest (login integrado) só
// enxerga a requisição com permissão para a API E para a página do Comunic Chat que a fez.
import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** Valida a URL e devolve a origem (sem caminho, sem barra no fim). */
function origin(raw, what) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`${what} inválido: ${raw}`); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error(`${what} precisa ser https:// (${raw})`);
  return u.origin;
}

const backendRaw = arg('backend') ?? process.env.BACKEND_URL;
if (!backendRaw) {
  console.error('\nInforme o backend no build:\n  npm run build -- --backend=https://177.93.130.128 --pbx=https://comunic.ras.yeastar.com\n');
  process.exit(1);
}
const BACKEND = origin(backendRaw, 'backend');
const PBXS = (arg('pbx') ?? process.env.PBX_URL ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean).map((p) => origin(p, 'PBX'));
if (!PBXS.length) console.warn('[build] aviso: nenhum --pbx informado; o SDK pode ser barrado ao falar com o PBX.');

/** Padrão de permissão do Chrome: sem porta. */
const pattern = (o) => { const u = new URL(o); return `${u.protocol}//${u.hostname}/*`; };
const BUILD_INFO = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${new URL(BACKEND).host}`;

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
  define: { __BACKEND_URL__: JSON.stringify(BACKEND), __BUILD_INFO__: JSON.stringify(BUILD_INFO) },
};

// Content script não pode ser módulo ES: build separado em IIFE.
/** @type {import('esbuild').BuildOptions} */
const contentOptions = {
  entryPoints: { 'click-to-call': 'src/content/click-to-call.ts' },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir,
  sourcemap: true,
  logLevel: 'info',
};

async function writeManifest() {
  const m = JSON.parse(await readFile('manifest.json', 'utf8'));
  m.host_permissions = [...new Set([...(m.host_permissions ?? []), pattern(BACKEND), ...PBXS.map(pattern)])];
  m.externally_connectable = { matches: [pattern(BACKEND)] };
  delete m.optional_host_permissions;
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(m, null, 2) + '\n');
}

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await Promise.all([
    writeManifest(),
    copyFile('src/offscreen.html', `${outdir}/offscreen.html`),
    copyFile('src/popup/popup.html', `${outdir}/popup.html`),
    copyFile('src/popup/popup.css', `${outdir}/popup.css`),
    copyFile('src/request-mic.html', `${outdir}/request-mic.html`),
    copyFile('assets/icon-16.png', `${outdir}/icon-16.png`),
    copyFile('assets/icon-32.png', `${outdir}/icon-32.png`),
    copyFile('assets/icon-48.png', `${outdir}/icon-48.png`),
    copyFile('assets/icon-128.png', `${outdir}/icon-128.png`),
  ]);
}

if (watch) {
  const ctx = await context(options);
  const ctxContent = await context(contentOptions);
  await Promise.all([ctx.rebuild(), ctxContent.rebuild()]);
  await copyStatic();
  await Promise.all([ctx.watch(), ctxContent.watch()]);
  console.log('esbuild observando mudanças... (Ctrl+C para sair)');
} else {
  await Promise.all([build(options), build(contentOptions)]);
  await copyStatic();
  console.log(`Build concluído em dist/ → backend ${BACKEND}${PBXS.length ? ' · PBX ' + PBXS.join(', ') : ''}`);
  console.log('Recarregue a extensão em chrome://extensions.');
}
