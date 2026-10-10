import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.argv = [
  process.execPath,
  fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
  ...process.argv.slice(2),
];
await import('../node_modules/next/dist/bin/next');
