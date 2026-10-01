import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { WORKSPACE_DIR } from './core-helper.js';

// Global in-memory registry of background processes
const managedProcesses = new Map();
let processCounter = 1;

/**
 * Checks if a given PID is currently active.
 */
export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Format uptime duration into a human-readable string.
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Starts a command as a managed background process.
 */
export async function startBackgroundProcess({ command, name, cwd, startupWaitMs = 1200 }) {
  if (!command || typeof command !== 'string') {
    throw new Error('Command must be a non-empty string.');
  }

  const targetCwd = cwd ? path.resolve(WORKSPACE_DIR, cwd) : WORKSPACE_DIR;
  const id = `proc-${processCounter++}`;
  const label = name ? name.trim() : command.trim().split(/\s+/)[0];

  const logDir = path.join(WORKSPACE_DIR, '.plumar', 'logs');
  try {
    await fs.mkdir(logDir, { recursive: true });
  } catch {}

  const logFilePath = path.join(logDir, `${id}.log`);
  const recentLogs = [];
  const maxRecentLogs = 300;

  const appendLog = (chunk, type = 'stdout') => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (!line && lines.length > 1) continue;
      const logEntry = `[${new Date().toISOString()}] [${type}] ${line}`;
      recentLogs.push(logEntry);
      if (recentLogs.length > maxRecentLogs) {
        recentLogs.shift();
      }
    }
    // Asynchronously append to disk log file
    fs.appendFile(logFilePath, chunk).catch(() => {});
  };

  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];

  const child = spawn(shell, args, {
    cwd: targetCwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const startTime = Date.now();
  const procEntry = {
    id,
    name: label,
    command,
    pid: child.pid,
    child,
    startTime,
    status: 'running',
    exitCode: null,
    logFilePath,
    recentLogs
  };

  managedProcesses.set(id, procEntry);

  child.stdout.on('data', (data) => appendLog(data, 'stdout'));
  child.stderr.on('data', (data) => appendLog(data, 'stderr'));

  child.on('error', (err) => {
    procEntry.status = 'failed';
    appendLog(`Process error: ${err.message}`, 'stderr');
  });

  child.on('exit', (code, signal) => {
    procEntry.exitCode = code;
    procEntry.status = code === 0 ? 'stopped' : 'failed';
    appendLog(`Process exited with code ${code} (${signal || 'none'})`, 'stdout');
  });

  if (child.unref && process.platform !== 'win32') {
    child.unref();
  }

  // Observation window: wait up to startupWaitMs (default ~10 seconds)
  // If the process exits early (e.g. short command), break early after a brief flush delay.
  // For long-running commands (e.g. servers), wait the full observation window to capture initialization logs.
  const waitDuration = Number.isFinite(startupWaitMs) && startupWaitMs > 0 ? startupWaitMs : 10000;
  const pollInterval = 100;
  const waitStart = Date.now();
  while (Date.now() - waitStart < waitDuration) {
    if (procEntry.exitCode !== null) {
      // Process finished early, allow 250ms for stream buffers to flush
      await new Promise((resolve) => setTimeout(resolve, 250));
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  const elapsedMs = Date.now() - waitStart;

  const isAlive = isProcessAlive(child.pid) && procEntry.status === 'running';

  const stdoutLogs = recentLogs
    .filter(l => l.includes('[stdout]'))
    .map(l => l.replace(/^\[.*?\] \[stdout\]\s?/, ''))
    .join('\n');
  const stderrLogs = recentLogs
    .filter(l => l.includes('[stderr]'))
    .map(l => l.replace(/^\[.*?\] \[stderr\]\s?/, ''))
    .join('\n');

  const combinedOutput = [stdoutLogs, stderrLogs].filter(Boolean).join('\n');

  const analysis = analyzeCommandOutput({
    command,
    name: label,
    processId: id,
    pid: child.pid,
    stdout: stdoutLogs,
    stderr: stderrLogs,
    isAlive,
    exitCode: procEntry.exitCode,
    observedMs: elapsedMs
  });

  const relativeLogPath = path.relative(WORKSPACE_DIR, logFilePath);

  if (!isAlive && procEntry.exitCode !== null && procEntry.exitCode !== 0) {
    return {
      success: false,
      processId: id,
      pid: child.pid,
      name: label,
      command,
      status: 'failed',
      exitCode: procEntry.exitCode,
      analysis,
      content: analysis.formattedContext,
      context: analysis.formattedContext,
      error: `Process terminated with exit code ${procEntry.exitCode}. ${analysis.summary}`,
      logs: recentLogs.slice(-25).join('\n'),
      output: combinedOutput,
      stdout: stdoutLogs,
      stderr: stderrLogs,
      logFile: relativeLogPath,
      message: analysis.summary
    };
  }

  return {
    success: true,
    processId: id,
    pid: child.pid,
    name: label,
    command,
    status: isAlive ? 'running' : (procEntry.status || 'stopped'),
    exitCode: procEntry.exitCode !== null ? procEntry.exitCode : (isAlive ? undefined : 0),
    analysis,
    content: analysis.formattedContext,
    context: analysis.formattedContext,
    output: combinedOutput,
    logFile: relativeLogPath,
    message: analysis.summary,
    initialLogs: recentLogs.slice(-25).join('\n'),
    stdout: stdoutLogs,
    stderr: stderrLogs
  };
}

/**
 * Analyzes command execution logs (stdout/stderr) over the observation window.
 * Extracts network endpoints, listening ports, health status, and compilation errors.
 * Formats a clean context block ready to be pasted directly into the model context.
 */
export function analyzeCommandOutput({
  command,
  name,
  processId,
  pid,
  stdout = '',
  stderr = '',
  isAlive = false,
  exitCode = null,
  observedMs = 10000
}) {
  const stripAnsi = (str) => (str || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
  const cleanStdout = stripAnsi(stdout);
  const cleanStderr = stripAnsi(stderr);
  const combinedOutput = [cleanStdout, cleanStderr].filter(Boolean).join('\n');

  // 1. Extract Network Endpoints & URLs
  const urlRegex = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^\s'"<>]*)?/gi;
  const rawUrls = combinedOutput.match(urlRegex) || [];
  const detectedUrls = Array.from(new Set(rawUrls.map(u => u.replace(/[.,;:)\]>]+$/, ''))));

  // 2. Extract Listening Ports
  const portSet = new Set();
  for (const u of detectedUrls) {
    try {
      const parsed = new URL(u);
      if (parsed.port) {
        portSet.add(parseInt(parsed.port, 10));
      }
    } catch {}
  }
  const portPatterns = [
    /(?:port|listening on|running on|started on|server on|at)\s*(?::\s*)?([0-9]{2,5})/gi,
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):([0-9]{2,5})/gi
  ];
  for (const pat of portPatterns) {
    let m;
    while ((m = pat.exec(combinedOutput)) !== null) {
      const p = parseInt(m[1], 10);
      if (p >= 80 && p <= 65535) {
        portSet.add(p);
      }
    }
  }
  const detectedPorts = Array.from(portSet);

  // 3. Error and Warning Detection
  const detectedErrors = [];
  const detectedWarnings = [];

  if (/EADDRINUSE|address already in use/i.test(combinedOutput)) {
    detectedErrors.push('Port conflict (EADDRINUSE): The requested port is already in use by another running service.');
  }
  const moduleMatch = combinedOutput.match(/(?:MODULE_NOT_FOUND|Cannot find module ['"]([^'"]+)['"])/i);
  if (moduleMatch) {
    detectedErrors.push(`Missing module dependency: '${moduleMatch[1] || 'unknown'}'. Run npm install.`);
  }
  const syntaxMatch = combinedOutput.match(/(?:SyntaxError:?\s*(.*?))(?:\r?\n|$)/i);
  if (syntaxMatch) {
    detectedErrors.push(`Syntax error: ${syntaxMatch[1].trim()}`);
  }
  if (/command not found|is not recognized as an internal or external command/i.test(combinedOutput)) {
    detectedErrors.push('Command not found in system PATH.');
  }
  if (/(?:Failed to compile|Compilation failed|TS[0-9]{4,5}:)/i.test(combinedOutput)) {
    detectedErrors.push('Build compilation failed with errors.');
  }

  // Scan general error lines if none of the specific ones were detected
  if (detectedErrors.length === 0 && cleanStderr) {
    const errorLines = cleanStderr
      .split('\n')
      .map(l => l.trim())
      .filter(l => /(?:error|exception|fatal|failed):/i.test(l) && !/(?:npm warn|deprecationwarning)/i.test(l));
    if (errorLines.length > 0) {
      detectedErrors.push(errorLines[0].slice(0, 150));
    }
  }

  // Warning detection
  const warnLines = combinedOutput
    .split('\n')
    .map(l => l.trim())
    .filter(l => /(?:warn|warning|deprecation):/i.test(l));
  if (warnLines.length > 0) {
    detectedWarnings.push(warnLines[0].slice(0, 150));
  }

  const hasFatalExit = !isAlive && exitCode !== null && exitCode !== 0;
  const hasErrors = detectedErrors.length > 0 || hasFatalExit;
  const isReady = /listening on|server running|ready in|compiled successfully|application bundle generation complete|connected to/i.test(combinedOutput);

  // 4. Synthesize Summary
  let summary = '';
  const durationSec = (observedMs / 1000).toFixed(1);
  const label = name || command;

  if (hasFatalExit) {
    summary = `Command "${label}" failed with exit code ${exitCode}. ${detectedErrors[0] || 'Check logs for details.'}`;
  } else if (!isAlive && exitCode === 0) {
    summary = `Command "${label}" finished successfully in ${durationSec}s with exit code 0.`;
  } else if (isAlive) {
    if (hasErrors) {
      summary = `Process "${label}" is running (PID: ${pid}), but issues were detected: ${detectedErrors[0]}`;
    } else if (detectedUrls.length > 0) {
      summary = `Service "${label}" started successfully in the background (PID: ${pid}) and is listening at ${detectedUrls.join(', ')} (observed ${durationSec}s).`;
    } else if (isReady) {
      summary = `Service "${label}" is running stably in the background (PID: ${pid}) and reported ready state (observed ${durationSec}s).`;
    } else {
      summary = `Service "${label}" is active and running in the background (PID: ${pid}). No startup errors observed in ${durationSec}s window.`;
    }
  } else {
    summary = `Process "${label}" stopped (exit code: ${exitCode ?? 0}).`;
  }

  // 5. Formatted Markdown Context Block for LLM context pasting
  const statusStr = isAlive ? '🟢 RUNNING IN BACKGROUND' : (exitCode === 0 ? '✅ COMPLETED' : '❌ FAILED');
  const formattedContext = [
    `### ⚙️ Command Execution & Output Analysis (Observed: ${durationSec}s)`,
    `- **Command**: \`${command}\``,
    `- **Service Name**: \`${name || 'unnamed'}\` (ID: \`${processId}\`, PID: \`${pid}\`)`,
    `- **Status**: ${statusStr}`,
    `- **Exit Code**: ${exitCode !== null ? exitCode : 'N/A (running in background)'}`,
    `- **Endpoints Detected**: ${detectedUrls.length > 0 ? detectedUrls.join(', ') : 'None'}`,
    `- **Ports Detected**: ${detectedPorts.length > 0 ? detectedPorts.join(', ') : 'None'}`,
    `- **Health**: ${hasErrors ? '⚠️ Errors Detected' : (isAlive ? '🟢 Healthy / Ready' : '✅ Finished Cleanly')}`,
    `- **Summary**: ${summary}`,
    '',
    '#### Captured Output Logs (stdout/stderr):',
    '```',
    combinedOutput || '(No stdout or stderr output produced during observation window)',
    '```'
  ].join('\n');

  return {
    status: isAlive ? 'running' : (exitCode === 0 ? 'completed' : 'failed'),
    summary,
    detectedUrls,
    detectedPorts,
    hasErrors,
    errors: detectedErrors,
    warnings: detectedWarnings,
    isReady,
    observedTimeMs: observedMs,
    formattedContext
  };
}

/**
 * Retrieve all currently alive background processes.
 */
export function getAliveBackgroundProcesses() {
  const result = [];
  for (const proc of managedProcesses.values()) {
    const alive = isProcessAlive(proc.pid);
    if (!alive && proc.status === 'running') {
      proc.status = proc.exitCode === 0 ? 'stopped' : 'failed';
    }
    if (alive && proc.status === 'running') {
      result.push({
        id: proc.id,
        name: proc.name,
        pid: proc.pid,
        command: proc.command,
        status: 'running',
        startTime: proc.startTime,
        uptime: formatUptime(Date.now() - proc.startTime),
        logFile: path.relative(WORKSPACE_DIR, proc.logFilePath)
      });
    }
  }
  return result;
}

/**
 * Find a managed process by ID, label name, or numeric PID.
 */
export function findManagedProcess({ processId, name, pid }) {
  if (processId && managedProcesses.has(processId)) {
    return managedProcesses.get(processId);
  }
  for (const proc of managedProcesses.values()) {
    if (processId && proc.id === processId) return proc;
    if (name && proc.name.toLowerCase() === name.toLowerCase()) return proc;
    if (pid && proc.pid === Number(pid)) return proc;
  }
  return null;
}

/**
 * List all managed background processes with live status check.
 */
export function listBackgroundProcesses() {
  const result = [];
  for (const proc of managedProcesses.values()) {
    const alive = isProcessAlive(proc.pid);
    if (!alive && proc.status === 'running') {
      proc.status = proc.exitCode === 0 ? 'stopped' : 'failed';
    }
    result.push({
      id: proc.id,
      name: proc.name,
      pid: proc.pid,
      command: proc.command,
      status: proc.status,
      uptime: alive ? formatUptime(Date.now() - proc.startTime) : 'inactive',
      exitCode: proc.exitCode,
      logFile: path.relative(WORKSPACE_DIR, proc.logFilePath)
    });
  }
  return result;
}

/**
 * Retrieve recent log lines for a background process.
 */
export async function getBackgroundProcessLogs({ processId, name, pid, lines = 50 }) {
  const proc = findManagedProcess({ processId, name, pid });
  if (!proc) {
    return {
      success: false,
      error: `Process not found matching criteria (id: "${processId || ''}", name: "${name || ''}", pid: "${pid || ''}").`
    };
  }

  const alive = isProcessAlive(proc.pid);
  if (!alive && proc.status === 'running') {
    proc.status = proc.exitCode === 0 ? 'stopped' : 'failed';
  }

  const requestedLines = Math.max(1, Math.min(Number(lines) || 50, 500));
  const output = proc.recentLogs.slice(-requestedLines).join('\n');

  return {
    success: true,
    processId: proc.id,
    name: proc.name,
    pid: proc.pid,
    status: proc.status,
    totalBufferedLines: proc.recentLogs.length,
    logs: output || '(No output recorded yet)'
  };
}

/**
 * Terminate a background process gracefully, falling back to force kill.
 */
export async function stopBackgroundProcess({ processId, name, pid, signal = 'SIGTERM' }) {
  const proc = findManagedProcess({ processId, name, pid });
  if (!proc) {
    return {
      success: false,
      error: `Process not found matching criteria (id: "${processId || ''}", name: "${name || ''}", pid: "${pid || ''}").`
    };
  }

  if (!isProcessAlive(proc.pid)) {
    proc.status = 'stopped';
    return {
      success: true,
      processId: proc.id,
      name: proc.name,
      pid: proc.pid,
      status: 'stopped',
      message: `Process "${proc.name}" (PID: ${proc.pid}) was already stopped.`
    };
  }

  try {
    if (process.platform === 'win32') {
      const { exec } = await import('child_process');
      await new Promise((resolve) => {
        exec(`taskkill /pid ${proc.pid} /T /F`, () => resolve());
      });
    } else {
      // Try killing the process group first
      try {
        process.kill(-proc.pid, signal);
      } catch {
        process.kill(proc.pid, signal);
      }
    }
  } catch (err) {
    // If standard kill fails, attempt SIGKILL
    try {
      process.kill(proc.pid, 'SIGKILL');
    } catch {}
  }

  proc.status = 'stopped';
  return {
    success: true,
    processId: proc.id,
    name: proc.name,
    pid: proc.pid,
    status: 'stopped',
    message: `Successfully terminated process "${proc.name}" (PID: ${proc.pid}).`
  };
}

/**
 * Stops all currently active background processes.
 */
export async function stopAllBackgroundProcesses() {
  const stopped = [];
  for (const proc of managedProcesses.values()) {
    if (isProcessAlive(proc.pid)) {
      await stopBackgroundProcess({ processId: proc.id });
      stopped.push(proc.name);
    }
  }
  return stopped;
}
