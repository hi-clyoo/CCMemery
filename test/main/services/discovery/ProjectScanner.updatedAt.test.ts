import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectScanner } from '../../../../src/main/services/discovery/ProjectScanner';

function createSessionLine(opts: { type?: string; timestamp?: string; role?: string }): string {
  return JSON.stringify({
    uuid: 'test-uuid',
    type: opts.type ?? 'user',
    message: { role: opts.role ?? 'user', content: 'hello' },
    timestamp: opts.timestamp ?? new Date().toISOString(),
    isMeta: false, // Must not be meta so the scanner recognizes it as the first real user message
  });
}

describe('ProjectScanner updatedAt logic', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Ignore cleanup failures
      }
    }
    tempDirs.length = 0;
  });

  it('preserves old createdAt from first user message but uses recent mtime for updatedAt', async () => {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-'));
    tempDirs.push(projectsDir);

    const encodedName = '-Users-test-myproject';
    const projectDir = path.join(projectsDir, encodedName);
    fs.mkdirSync(projectDir);

    const filePath = path.join(projectDir, 'session-timestamp-test.jsonl');
    
    // Simulate an old first user message (weeks ago)
    const oldDateMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oldIsoString = new Date(oldDateMs).toISOString();

    fs.writeFileSync(
      filePath,
      createSessionLine({ type: 'user', role: 'user', timestamp: oldIsoString }) + '\n'
    );

    // Force the file mtime to be exactly now
    const nowMs = Date.now();
    fs.utimesSync(filePath, new Date(nowMs), new Date(nowMs));

    const scanner = new ProjectScanner(projectsDir);
    const sessions = await scanner.listSessions(encodedName);
    
    expect(sessions).toHaveLength(1);
    
    const session = sessions[0];
    
    // createdAt should strictly use the old message timestamp
    expect(session.createdAt).toBe(Math.floor(oldDateMs));
    
    // updatedAt should use the forced recent file mtime (within ~1 second variance depending on fs resolution)
    expect(session.updatedAt).toBeDefined();
    expect(Math.abs(session.updatedAt! - nowMs)).toBeLessThan(2000);
  });
});
