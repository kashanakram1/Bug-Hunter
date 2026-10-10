import { format } from 'prettier';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
for (const dir of ['components/competition', 'app', 'lib'])
  for (const path of files(join(root, dir)).filter((p) => /\.(tsx?|css)$/.test(p))) {
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, await format(text, { filepath: path, singleQuote: true, printWidth: 100 }));
  }
for (const file of readdirSync(join(root, 'scripts')).filter((x) =>
  /^(database|configure-env|test-database|load-test|browser-check|browser-workflow|hosted-load|serve-static|live-check|next|format-source)\.mjs$/.test(
    x,
  ),
)) {
  const path = join(root, 'scripts', file);
  writeFileSync(
    path,
    await format(readFileSync(path, 'utf8'), {
      filepath: path,
      singleQuote: true,
      printWidth: 100,
    }),
  );
}
console.log('Formatted application source and project scripts.');
