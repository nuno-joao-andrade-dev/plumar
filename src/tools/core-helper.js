import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const WORKSPACE_DIR = process.cwd();
export const INSTALL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function getWorkspaceDir() {
  return process.cwd();
}

export const getGenAIClient = () => {
  // Enforce 100% local-only model constraint. External cloud models are disabled.
  return null;
};

function isInsideDir(targetPath, baseDir) {
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  return targetPath === baseDir || targetPath.startsWith(baseWithSep);
}

// Safe path resolver strictly confined to the current working directory (process.cwd()),
// including protection against active and dangling symbolic link escapes.
export function resolveSafePath(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath || typeof relativeOrAbsolutePath !== 'string') {
    throw new Error('Access denied: Provided path must be a non-empty string.');
  }
  const currentDir = process.cwd();
  const resolved = path.resolve(currentDir, relativeOrAbsolutePath);

  if (!isInsideDir(resolved, currentDir)) {
    throw new Error('Access denied: Action not permitted outside workspace directory.');
  }

  let realCurrentDir = currentDir;
  try {
    realCurrentDir = fs.realpathSync(currentDir);
  } catch {}

  let checkPath = resolved;
  while (checkPath && checkPath !== path.dirname(checkPath)) {
    let stat = null;
    try {
      stat = fs.lstatSync(checkPath);
    } catch {
      stat = null;
    }

    if (stat) {
      try {
        const realCheckPath = fs.realpathSync(checkPath);
        if (!isInsideDir(realCheckPath, realCurrentDir) && !isInsideDir(realCheckPath, currentDir)) {
          throw new Error('Access denied: Action not permitted outside workspace directory.');
        }
      } catch (err) {
        if (err.message.startsWith('Access denied:')) throw err;
        // Dangling symlink: resolve link target manually and verify confinement
        if (stat.isSymbolicLink()) {
          try {
            const rawTarget = fs.readlinkSync(checkPath);
            const resolvedTarget = path.resolve(path.dirname(checkPath), rawTarget);
            if (!isInsideDir(resolvedTarget, realCurrentDir) && !isInsideDir(resolvedTarget, currentDir)) {
              throw new Error('Access denied: Action not permitted outside workspace directory.');
            }
          } catch (linkErr) {
            if (linkErr.message.startsWith('Access denied:')) throw linkErr;
            throw new Error('Access denied: Action not permitted outside workspace directory.');
          }
        }
      }
      break;
    }
    checkPath = path.dirname(checkPath);
  }

  return resolved;
}

export function parseHexColor(hex) {
  if (!hex) return 0xffffffff;
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  if (clean.length === 6) {
    clean = clean + 'ff';
  }
  return parseInt(clean, 16) >>> 0;
}

let lastWorkspaceFile = null;

export function setLastWorkspaceFile(filePath) {
  if (filePath && typeof filePath === 'string') {
    lastWorkspaceFile = filePath;
  }
}

export function getLastWorkspaceFile() {
  return lastWorkspaceFile;
}

export function resetLastWorkspaceFile() {
  lastWorkspaceFile = null;
}

