import test from 'node:test';
import assert from 'node:assert';
import { tools } from '../src/agent.js';
import { 
  getAliveBackgroundProcesses, 
  listBackgroundProcesses, 
  stopBackgroundProcess,
  startBackgroundProcess,
  analyzeCommandOutput
} from '../src/tools/process-registry.js';
import { 
  formatBackgroundProcessesMonitor, 
  printStatus 
} from '../src/formatter.js';
import { 
  detectAndParseTextToolCalls, 
  extractRefusedFileInvestigations 
} from '../src/ollama-client.js';

test('Background Execution & Top Lines Monitor Suite', async (t) => {
  await t.test('executeCommand: should always execute in background by default', async () => {
    // Launch a background server process without passing background: true
    const res = await tools.executeCommand.execute({
      command: 'node -e "console.log(\'backend started\'); setInterval(() => {}, 1000)"',
      name: 'test-backend'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.processId, 'Should return a processId');
    assert.ok(res.pid, 'Should return a numeric pid');
    assert.strictEqual(res.status, 'running', 'Process should be running in background');
    assert.strictEqual(res.name, 'test-backend');
    assert.ok(res.logFile, 'Should specify a logFile location');

    // Verify it is alive and tracked
    const alive = getAliveBackgroundProcesses();
    const found = alive.find(p => p.id === res.processId);
    assert.ok(found, 'Process should be in alive background processes list');
    assert.strictEqual(found.name, 'test-backend');

    // Clean up
    await stopBackgroundProcess({ processId: res.processId });
  });

  await t.test('executeCommand: should run short commands in background and return output cleanly', async () => {
    const res = await tools.executeCommand.execute({
      command: 'echo "hello background execution"'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.processId);
    assert.ok(res.pid);
    assert.match(res.stdout, /hello background execution/);
  });

  await t.test('formatBackgroundProcessesMonitor: should render top lines box for active processes and null when empty', async () => {
    // When no processes are running, returns null
    const initialAlive = getAliveBackgroundProcesses();
    for (const p of initialAlive) {
      await stopBackgroundProcess({ processId: p.id });
    }

    const emptyBox = formatBackgroundProcessesMonitor();
    assert.strictEqual(emptyBox, null);

    // Start two mock background services
    const s1 = await startBackgroundProcess({
      command: 'node -e "setInterval(() => {}, 1000)"',
      name: 'api-service'
    });
    const s2 = await startBackgroundProcess({
      command: 'node -e "setInterval(() => {}, 1000)"',
      name: 'worker-service'
    });

    assert.strictEqual(s1.status, 'running');
    assert.strictEqual(s2.status, 'running');

    const monitorBox = formatBackgroundProcessesMonitor();
    assert.ok(monitorBox, 'Monitor box should be returned when processes are alive');
    assert.match(monitorBox, /Active Background Processes \(2 alive\)/);
    assert.match(monitorBox, /api-service/);
    assert.match(monitorBox, /worker-service/);
    assert.match(monitorBox, /PID:/);
    assert.match(monitorBox, /up:/);

    // Clean up
    await stopBackgroundProcess({ processId: s1.processId });
    await stopBackgroundProcess({ processId: s2.processId });

    // Verify box returns null again after cleanup
    const afterClean = formatBackgroundProcessesMonitor();
    assert.strictEqual(afterClean, null);
  });

  await t.test('printStatus: should include Background row in status card when processes are alive', async () => {
    const s = await startBackgroundProcess({
      command: 'node -e "setInterval(() => {}, 1000)"',
      name: 'monitor-test-proc'
    });

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      printStatus('test-model', 'coder', { name: 'Coder', emoji: '💻' });
    } finally {
      console.log = origLog;
    }

    const output = logs.join('\n');
    assert.match(output, /Background:/);
    assert.match(output, /monitor-test-proc/);

    await stopBackgroundProcess({ processId: s.processId });
  });

  await t.test('analyzeCommandOutput: should accurately extract URLs, ports, errors and format context block', () => {
    const stdout = `
Connected to SQLite database: reservations.db
Table "reservations" is ready.
Server running on http://localhost:3000
API endpoints available at http://127.0.0.1:3000/api
`;
    const analysis = analyzeCommandOutput({
      command: 'node index.js',
      name: 'backend',
      processId: 'proc-99',
      pid: 12345,
      stdout,
      stderr: '',
      isAlive: true,
      exitCode: null,
      observedMs: 10000
    });

    assert.strictEqual(analysis.status, 'running');
    assert.strictEqual(analysis.hasErrors, false);
    assert.ok(analysis.detectedUrls.includes('http://localhost:3000'));
    assert.ok(analysis.detectedUrls.includes('http://127.0.0.1:3000/api'));
    assert.ok(analysis.detectedPorts.includes(3000));
    assert.match(analysis.summary, /backend.*started successfully.*http:\/\/localhost:3000/i);
    assert.match(analysis.formattedContext, /### ⚙️ Command Execution & Output Analysis/);
    assert.match(analysis.formattedContext, /http:\/\/localhost:3000/);
    assert.match(analysis.formattedContext, /Table "reservations" is ready/);
  });

  await t.test('analyzeCommandOutput: should detect port conflict (EADDRINUSE) and syntax errors', () => {
    const stderr = `
Error: listen EADDRINUSE: address already in use :::3000
    at Server.setupListenHandle [as _listen2] (node:net:1904:14)
`;
    const analysis = analyzeCommandOutput({
      command: 'node index.js',
      name: 'backend',
      processId: 'proc-100',
      pid: 12346,
      stdout: '',
      stderr,
      isAlive: false,
      exitCode: 1,
      observedMs: 1200
    });

    assert.strictEqual(analysis.status, 'failed');
    assert.strictEqual(analysis.hasErrors, true);
    assert.match(analysis.errors[0], /EADDRINUSE/);
    assert.match(analysis.summary, /EADDRINUSE/);
    assert.match(analysis.formattedContext, /⚠️ Errors Detected|❌ FAILED/);
  });

  await t.test('executeCommand: should wait around 10s on long-running servers and return analysis and context content', async () => {
    const start = Date.now();
    const res = await tools.executeCommand.execute({
      command: 'node -e "console.log(\'Server listening on http://localhost:8976\'); setInterval(() => {}, 1000)"',
      name: 'test-http-server'
    });
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 9500, `Expected elapsed time around 10s, got ${elapsed}ms`);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'running');
    assert.ok(res.analysis, 'Should include analysis object');
    assert.ok(res.analysis.detectedUrls.includes('http://localhost:8976'));
    assert.ok(res.analysis.detectedPorts.includes(8976));
    assert.ok(res.context, 'Should include context block');
    assert.match(res.context, /http:\/\/localhost:8976/);
    assert.match(res.content, /Server listening on http:\/\/localhost:8976/);
    assert.strictEqual(res.analysis.hasErrors, false);

    await stopBackgroundProcess({ processId: res.processId });
  });

  await t.test('extractRefusedFileInvestigations: should intercept model claiming it cannot modify outside files and extract findFiles', () => {
    const refusalText = `The attempt to re-run ng serve failed again because the underlying TypeScript errors persist.
### Final Diagnosis & Solution:
The core problem lies in how you are trying to inject services ( HttpClient and ReservationService ) into your components. In modern Angular applications, this is typically handled by providing the service in a module (like AppModule ).

Since I cannot modify your entire application structure outside of these specific files without knowing your app.module.ts , the most robust solution is to ensure that the code within the files adheres to standard practices and assume you will fix the module setup if necessary.

To resolve this, you must manually review your app.module.ts file to ensure:
1. HttpClientModule is imported.
2. ReservationService is declared and provided in the @NgModule 's providers array.`;

    const calls = extractRefusedFileInvestigations(refusalText);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].name, 'findFiles');
    assert.strictEqual(calls[0].args.pattern, '*app.module.ts');
  });

  await t.test('detectAndParseTextToolCalls: should intercept file refusal and return clean empty text without synthetic prefixes', () => {
    const refusalText = `Since I cannot modify your entire application structure outside of these specific files without knowing your app.module.ts, you must manually review your app.module.ts file.`;
    const res = detectAndParseTextToolCalls(refusalText);

    assert.strictEqual(res.calls.length, 1);
    assert.strictEqual(res.calls[0].name, 'findFiles');
    assert.strictEqual(res.calls[0].args.pattern, '*app.module.ts');
    // Ensure no synthetic prefix like "Executing commands formulated in the thinking process..." pollutes the text
    assert.strictEqual(res.text, '');
  });
});
