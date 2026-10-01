import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

export const WORKSPACE_DIR = process.cwd();
export const INSTALL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const getGenAIClient = () => {
  // Enforce 100% local-only model constraint. External cloud models are disabled.
  return null;
};


// Safe path resolver to prevent path traversal outside the workspace
export function resolveSafePath(relativeOrAbsolutePath, allowProjectsDir = false) {
  if (!relativeOrAbsolutePath || typeof relativeOrAbsolutePath !== 'string') {
    throw new Error('Access denied: Provided path must be a non-empty string.');
  }
  const resolved = path.resolve(WORKSPACE_DIR, relativeOrAbsolutePath);
  const allowedBase = '/home/nandrade/projects';
  const shouldAllowProjects = allowProjectsDir || process.env.PLUMAR_ALLOW_PROJECTS_DIR === 'true';
  const isAllowedProjects = shouldAllowProjects && resolved.startsWith(allowedBase);
  if (!resolved.startsWith(WORKSPACE_DIR) && !isAllowedProjects) {
    throw new Error('Access denied: Action not permitted outside workspace directory.');
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

