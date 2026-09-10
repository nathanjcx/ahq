#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

try {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!['meeting', 'email', 'slack', 'state', 'retry'].includes(command))
    throw new Error(
      'Usage: node scripts/demo-trigger.mjs meeting|email|slack|state|retry [notification-id] [--connection path] [--user-data directory] [--key idempotency-key]',
    );
  const id = command === 'retry' ? args.shift() : undefined;
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (!['--connection', '--user-data', '--key'].includes(flag) || !args.length)
      throw new Error(`Unknown or incomplete option: ${flag}`);
    options[flag] = args.shift();
  }
  const config =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.APPDATA
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const connection =
    options['--connection'] ||
    path.join(options['--user-data'] || path.join(config, 'astra-hq'), 'demo-connection.json');
  const { port, token } = JSON.parse(await readFile(connection, 'utf8'));
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error('Invalid demo connection file.');
  if (command === 'retry' && (!id || !/^[a-zA-Z0-9-]+$/.test(id)))
    throw new Error('Retry requires a notification ID.');
  const route =
    command === 'state' ? '/state' : command === 'retry' ? `/notifications/${id}/retry` : '/notifications';
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: command === 'state' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(command !== 'state' && command !== 'retry'
      ? { body: JSON.stringify({ kind: command, idempotencyKey: options['--key'] }) }
      : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
