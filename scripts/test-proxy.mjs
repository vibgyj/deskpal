// Runs the proxy conformance test for each port whose runtime is installed.
import { spawnSync } from 'node:child_process';

const ports = [
  ['node', process.execPath],
  ['python', process.env.PYTHON ?? 'python3'],
  ['php', process.env.PHP ?? 'php'],
];
let failed = false;
for (const [name, bin] of ports) {
  if (spawnSync(bin, ['--version']).status !== 0) {
    console.log(`proxy/${name}: skipped (${bin} not found)`);
    continue;
  }
  const run = spawnSync(process.execPath, ['proxy/test/conformance.mjs', name, ...process.argv.slice(2)], { stdio: 'inherit' });
  failed ||= run.status !== 0;
}
process.exit(failed ? 1 : 0);
