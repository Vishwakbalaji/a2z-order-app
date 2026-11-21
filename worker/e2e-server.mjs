// Starts a fresh local copy of the sync Worker for the end-to-end tests (empty database every run).
import { rmSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const state = path.join(dir, '.wrangler-e2e');
rmSync(state, { recursive: true, force: true });
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
execSync(`npx wrangler d1 migrations apply a2z-order-sync --local --persist-to "${state}"`, { cwd: dir, stdio: 'inherit', env });
const child = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8787', '--persist-to', state, '--var', 'TEST_MODE:1'], { cwd: dir, stdio: 'inherit', env });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => process.exit(code ?? 0));
