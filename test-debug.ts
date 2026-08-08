import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectScanner } from './src/main/services/discovery/ProjectScanner';

async function run() {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-'));
  const encodedName = '-Users-test-myproject';
  const projectDir = path.join(projectsDir, encodedName);
  fs.mkdirSync(projectDir);

  const filePath = path.join(projectDir, 'session-timestamp-test.jsonl');
  
  const oldDateMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const oldIsoString = new Date(oldDateMs).toISOString();

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      uuid: 'test-uuid',
      type: 'user',
      message: { role: 'user', content: 'hello' },
      timestamp: oldIsoString,
      isMeta: false,
    }) + '\n'
  );

  const nowMs = Date.now();
  fs.utimesSync(filePath, new Date(nowMs), new Date(nowMs));

  const scanner = new ProjectScanner(projectsDir);
  const projects = await scanner.scanProject(encodedName);
  const sessions = await scanner.listSessions(encodedName);
  console.log(JSON.stringify(sessions, null, 2));
}
run();
