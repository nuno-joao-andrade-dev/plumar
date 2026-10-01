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

  // Brief startup verification window to catch immediate startup crashes
  if (startupWaitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, startupWaitMs));
  }

  const isAlive = isProcessAlive(child.pid) && procEntry.status === 'running';

  if (!isAlive && procEntry.exitCode !== null && procEntry.exitCode !== 0) {
    return {
      success: false,
      processId: id,
      pid: child.pid,
      name: label,
      status: 'failed',
      exitCode: procEntry.exitCode,
      error: `Process terminated immediately after start with exit code ${procEntry.exitCode}.`,
      logs: recentLogs.slice(-25).join('\n')
    };
  }

  return {
    success: true,
    processId: id,
    pid: child.pid,
    name: label,
    command,
    status: isAlive ? 'running' : (procEntry.status || 'stopped'),
    logFile: path.relative(WORKSPACE_DIR, logFilePath),
    message: `Background service "${label}" (PID: ${child.pid}) started successfully in background.`,
    initialLogs: recentLogs.slice(-20).join('\n')
  };
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
