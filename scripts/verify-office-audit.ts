import { readFile } from 'node:fs/promises';
import { verifyOfficeAudit } from '../runtime/store';
import type { OfficeAuditExport } from '../shared/office-events';

const file = process.argv[2];
if (!file) {
  process.stderr.write('Usage: npm run audit:verify -- /path/to/Astra-HQ-audit.json\n');
  process.exitCode = 2;
} else {
  try {
    const packet = JSON.parse(await readFile(file, 'utf8')) as OfficeAuditExport;
    const verification = verifyOfficeAudit(packet);
    process.stdout.write(`${JSON.stringify({ file, anchor: packet.anchor, verification }, null, 2)}\n`);
    // Legacy data remains unverified, but is distinct from detected corruption.
    process.exitCode = verification.issues.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `Could not verify archive: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
