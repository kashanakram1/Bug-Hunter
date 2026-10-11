import { fileURLToPath } from 'node:url';
import { configureBrowserEnvironment } from './configure-env.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
if (['build', 'dev'].includes(process.argv[2])) {
  configureBrowserEnvironment(process.argv[2] === 'build' ? 'production' : 'development');
}
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.argv = [
  process.execPath,
  fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
  ...process.argv.slice(2),
];
await import('../node_modules/next/dist/bin/next');
