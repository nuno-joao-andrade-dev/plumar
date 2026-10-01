import test from 'node:test';
import assert from 'node:assert';
import { tools } from '../src/agent.js';
import { 
  getAliveBackgroundProcesses, 
  listBackgroundProcesses, 
  stopBackgroundProcess,
  startBackgroundProcess
} from '../src/tools/process-registry.js';
import { 
  formatBackgroundProcessesMonitor, 
  printStatus 
} from '../src/formatter.js';

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
});
