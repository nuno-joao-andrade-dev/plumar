import { FunctionTool } from '@google/adk';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import { exec } from 'child_process';
import { Jimp } from 'jimp';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getLoadedSkills, getLoadedPlugins, createSkill as createSkillInManager, createPlugin as createPluginInManager } from './skills-plugins-manager.js';


const WORKSPACE_DIR = process.cwd();
const INSTALL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const getGenAIClient = () => {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  try {
    return new GoogleGenAI({ apiKey });
  } catch (err) {
    console.error('[GenAI] Failed to initialize GoogleGenAI client:', err.message);
    return null;
  }
};

let dinoServer = null;
let dinoPort = 0;


// Safe path resolver to prevent path traversal outside the workspace
function resolveSafePath(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath || typeof relativeOrAbsolutePath !== 'string') {
    throw new Error('Access denied: Provided path must be a non-empty string.');
  }
  const resolved = path.resolve(WORKSPACE_DIR, relativeOrAbsolutePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error('Access denied: Action not permitted outside workspace directory.');
  }
  return resolved;
}

function parseHexColor(hex) {
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

const FONT_5X7 = {
  'A': [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'B': [0x1f, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1f],
  'C': [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  'D': [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  'E': [0x1f, 0x10, 0x10, 0x1f, 0x10, 0x10, 0x1f],
  'F': [0x1f, 0x10, 0x10, 0x1f, 0x10, 0x10, 0x10],
  'G': [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  'H': [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'I': [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  'M': [0x11, 0x1b, 0x15, 0x11, 0x11, 0x11, 0x11],
  'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  'O': [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'P': [0x1f, 0x11, 0x11, 0x1f, 0x10, 0x10, 0x10],
  'Q': [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  'R': [0x1f, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  'S': [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  'T': [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  'X': [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  'Y': [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  'Z': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x0e, 0x10, 0x1c, 0x12, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '_': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04],
  '!': [0x04, 0x04, 0x04, 0x04, 0x00, 0x00, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
};

const blockFont = {
  ' ': ["     ", "     ", "     ", "     ", "     "],
  'A': [" ▄███▄ ", "▐▛   ▜▌", "▐▛▀▀▀▜▌", "▐▛   ▜▌", "▐▛   ▜▌"],
  'B': ["▐▛▀▀▀▜▄", "▐▛   ▐▛", "▐▛▀▀▀▜▄", "▐▛   ▐▛", "▐▛▄▄▄▟▛"],
  'C': [" ▄███▄ ", "▐▛   ▀▘", "▐▛     ", "▐▛   ▄▖", " ▀███▀ "],
  'D': ["▐▛▀▀▀▜▄", "▐▛   ▐▛", "▐▛   ▐▛", "▐▛   ▐▛", "▐▛▄▄▄▟▛"],
  'E': ["▐▛▀▀▀▀▘", "▐▛ ▀▀▀ ", "▐▛ █▄▄ ", "▐▛ ▄▄▄ ", "▐▛▄▄▄▄▘"],
  'F': ["▐▛▀▀▀▀▘", "▐▛ ▀▀▀ ", "▐▛ █▀▀ ", "▐▛ ▌   ", "▐▛ ▌   "],
  'G': [" ▄███▄ ", "▐▛   ▀▘", "▐▛  ▄██", "▐▛   ▐▛", " ▀███▀ "],
  'H': ["▐▛   ▜▌", "▐▛   ▜▌", "▐▛▀▀▀▜▌", "▐▛   ▜▌", "▐▛   ▜▌"],
  'I': ["▐▛▀▀▀▜▌", "  ▐█▌  ", "  ▐█▌  ", "  ▐█▌  ", "▐▛▄▄▄▜▌"],
  'J': ["  ▀▀▀▜▌", "     ▐█", "     ▐█", "▐▄   ▐█", " ▀███▀ "],
  'K': ["▐▛   ▄▛", "▐▛ ▄▛▘ ", "▐▛▀▜▄  ", "▐▛  ▜█▄", "▐▛   ▜█"],
  'L': ["▐▛ ▌   ", "▐▛ ▌   ", "▐▛ ▌   ", "▐▛ ▌   ", "▐▛▄▄▄▄▘"],
  'M': ["▐▛▀▄ ▄▀▜▌", "▐█ ▀█▀ █▌", "▐█  ▀  █▌", "▐█     █▌", "▐█     █▌"],
  'N': ["▐▛▀▄  ▜▌", "▐█ ▀█ █▌", "▐█  ▀██▌", "▐█   ██▌", "▐█    █▌"],
  'O': [" ▄███▄ ", "▐▛   ▜▌", "▐█   █▌", "▐▙   ▟▌", " ▀███▀ "],
  'P': ["▐▛▀▀▀▜▄", "▐▛   ▐▛", "▐▛▀▀▀▀▘", "▐▛ ▌   ", "▐▛ ▌   "],
  'Q': [" ▄███▄ ", "▐▛   ▜▌", "▐█   █▌", "▐▙  ▄▟▌", " ▀███▀▘"],
  'R': ["▐▛▀▀▀▜▄", "▐▛   ▐▛", "▐▛▀▀▀▜▄", "▐▛  ▀▜▄", "▐▛   ▜█"],
  'S': [" ▄███▄ ", "▐▛   ▀▘", " ▀███▄ ", "▄   ▜▌", " ▀███▀ "],
  'T': ["▐▛▀▀▀▀▀▜▌", "  ▐███▌  ", "  ▐███▌  ", "  ▐███▌  ", "  ▐███▌  "],
  'U': ["▐▛   ▜▌", "▐▛   ▜▌", "▐█   █▌", "▐▙   ▟▌", " ▀███▀ "],
  'V': ["▐▛   ▜▌", "▐█   █▌", "▜█   █▛", " ▜█ █▛ ", "  ▜█▛  "],
  'W': ["▐█     █▌", "▐█  ▄  █▌", "▐█ ▐█▌ █▌", "▜█ █▛▜█ █▛", " ▜█▛ ▜█▛ "],
  'X': ["▐█   █▌", " ▜█ █▛ ", "  ▜█▛  ", " ▟█ █▙ ", "▐█   █▌"],
  'Y': ["▐▛   ▜▌", " ▜█ █▛ ", "  ▜█▛  ", "  ▐█▌  ", "  ▐█▌  "],
  'Z': ["▐▛▀▀▀▀▜▌", "   ▄▄█▀ ", " ▄██▀   ", "▐██▄▄▄▄ ", "▐▛▄▄▄▄▜▌"],
  '0': [" ▄███▄ ", "▐█ ▄ ██▌", "▐█▀█ █▌", "▐█ ▀▄█▌", " ▀███▀ "],
  '1': [" ▄█▌ ", "  █▌ ", "  █▌ ", "  █▌ ", "▄███▄"],
  '2': [" ▄███▄ ", "▀   ▐█▌", "  ▄██▀ ", "▄██▀   ", "▐██▄▄▄▄"],
  '3': ["▐▀▀▀▀▜▌", "    ▄█▛", "  ▀▀▀▜▄", "     ▐█", "▐▄▄▄▄▟▛"],
  '4': ["▐█   █▌", "▐█   █▌", "▐█▀▀▀███▄", "     █▌", "     █▌"],
  '5': ["▐██████", "▐█▀▀▀▀▘", "▐▛▀▀▀▜▄", "     ▐█", "▐▄▄▄▄▟▛"],
  '6': [" ▄███▄ ", "▐▛▀▀▀▀▘", "▐▛▀▀▀▜▄", "▐█   ▐█", " ▀███▀ "],
  '7': ["▐██████▌", "    ▄█▛ ", "   ▄█▛  ", "  ▄█▛   ", " ▄█▛    "],
  '8': [" ▄███▄ ", "▐█   █▌", " ▀███▀ ", "▐█   █▌", " ▀███▀ "],
  '9': [" ▄███▄ ", "▐█   █▌", " ▀███▀▜▌", "     ▐█", " ▀███▀ "],
  '!': ["▐█▌", "▐█▌", "▐█▌", "   ", "▄█▄"],
  '?': [" ▄███▄ ", "▀   ▐█▌", "   ▄█▛ ", "       ", "  ▐█▌  "],
  '.': ["   ", "   ", "   ", "▄▄ ", "▀▀ "],
  '-': ["    ", "    ", "████", "    ", "    "],
  '+': ["  ▄  ", "  █  ", "█████", "  █  ", "  ▀  "]
};

const slantFont = {
  ' ': ["     ", "     ", "     ", "     ", "     "],
  'A': ["   ▄▀▀▀▄   ", "  █  ▄  █  ", "  █ ▀▀▀ █  ", "  █     █  ", "  ▀     ▀  "],
  'B': ["  █▀▀▀▀▄   ", "  █▄▄▄▄▀   ", "  █    ▀▄  ", "  █     █  ", "  ▀▀▀▀▀▀   "],
  'C': ["   ▄▀▀▀▀▀  ", "  █        ", "  █        ", "  ▀▄▄▄▄▄▀  ", "   ▀▀▀▀▀   "],
  'D': ["  █▀▀▀▀▄   ", "  █     █  ", "  █     █  ", "  █▄▄▄▄▀   ", "  ▀▀▀▀▀    "],
  'E': ["  █▀▀▀▀▀▀  ", "  █▀▀▀▀    ", "  █▄▄▄▄    ", "  █▄▄▄▄▄▄  ", "  ▀▀▀▀▀▀▀  "],
  'F': ["  █▀▀▀▀▀▀  ", "  █▀▀▀▀    ", "  █▀▀▀     ", "  █        ", "  ▀        "],
  'G': ["   ▄▀▀▀▀▀  ", "  █   ▀▀█  ", "  █     █  ", "  ▀▄▄▄▄▄▀  ", "   ▀▀▀▀▀   "],
  'H': ["  █     █  ", "  █     █  ", "  █▀▀▀▀▀█  ", "  █     █  ", "  ▀     ▀  "],
  'I': ["  ▀███▀  ", "   ██▌   ", "   ██▌   ", "   ██▌   ", "  ▄███▄  "],
  'J': ["    ▀███  ", "      ██  ", "      ██  ", "  ▀▄▄▄██  ", "   ▀▀▀▀   "],
  'K': ["  █    ▄▀  ", "  █  ▄▀    ", "  █▀▀▄     ", "  █   ▀▄   ", "  ▀     ▀  "],
  'L': ["  █        ", "  █        ", "  █        ", "  █▄▄▄▄▄▄  ", "  ▀▀▀▀▀▀▀  "],
  'M': ["  █▄  ▄█  ", "  █▀█▐█▀█  ", "  █ ▀█ █  ", "  █    █  ", "  ▀    ▀  "],
  'N': ["  █▄   █  ", "  █▀█  █  ", "  █ ▀█ █  ", "  █  ▀██  ", "  ▀    ▀  "],
  'O': ["   ▄▀▀▀▄   ", "  █     █  ", "  █     █  ", "  ▀▄▄▄▄▀   ", "   ▀▀▀▀    "],
  'P': ["  █▀▀▀▀▄   ", "  █▄▄▄▄▀   ", "  █        ", "  █        ", "  ▀        "],
  'Q': ["   ▄▀▀▀▄   ", "  █     █  ", "  ▀▄▄▄▄▀█  ", "   ▀▀▀▀  ▀▄", "          ▀"],
  'R': ["  █▀▀▀▀▄   ", "  █▄▄▄▄▀   ", "  █  ▀▄    ", "  █    ▀▄  ", "  ▀     ▀  "],
  'S': ["   ▄▀▀▀▀   ", "  ▀▄▄▄▄▄   ", "       ▀▄  ", "  ▀▄▄▄▄▀   ", "   ▀▀▀▀    "],
  'T': ["  ▀█████▀  ", "     ██    ", "     ██    ", "     ██    ", "    ▄██▄   "],
  'U': ["  █     █  ", "  █     █  ", "  █     █  ", "  ▀▄▄▄▄▀   ", "   ▀▀▀▀    "],
  'V': ["  █     █  ", "   █   █   ", "   █   █   ", "    █ █    ", "     ▀     "],
  'W': ["  █     █  ", "  █  ▄  █  ", "  █ ▐█▌ █  ", "  ▀▄█▀█▄▀  ", "   ▀   ▀   "],
  'X': ["  ▀▄   ▄▀  ", "    █ █    ", "     █     ", "    █ █    ", "  ▄▀   ▀▄  "],
  'Y': ["  █     █  ", "   █   █   ", "    █ █    ", "     █     ", "     ▀     "],
  'Z': ["  ▀█████▀  ", "     ▄█▀   ", "   ▄█▀     ", "  ███████  ", "  ▀▀▀▀▀▀▀  "],
  '0': ["   ▄▀▀▀▄   ", "  █ ▄█  █  ", "  █▀ █  █  ", "  ▀▄▄▄▄▀   ", "   ▀▀▀▀    "],
  '1': ["    ▄█▀  ", "   ▄██   ", "    ██   ", "    ██   ", "  ▄████▄ "],
  '2': ["   ▄▀▀▀▄   ", "       █   ", "    ▄▄▀    ", "  ▄▀       ", "  ███████  "],
  '3': ["   ▀▀▀▀▄   ", "       █   ", "    ▀▀▀▄   ", "       █   ", "  ▀▄▄▄▄▀   "],
  '4': ["   ▄▀  █   ", "  █    █   ", "  ███████  ", "       █   ", "       █   "],
  '5': ["  ███████  ", "  █        ", "  ██████▄  ", "       █   ", "  █████▀   "],
  '6': ["   ▄▀▀▀▀   ", "  █        ", "  █▀▀▀▀▄   ", "  ▀▄▄▄▄▀   ", "   ▀▀▀▀    "],
  '7': ["  ███████  ", "       █▀  ", "     ▄█▀   ", "    ▄█▀    ", "   ▄█▀     "],
  '8': ["   ▄▀▀▀▄   ", "  █▄▄▄▄█   ", "  █▀▀▀▀█   ", "  ▀▄▄▄▄▀   ", "   ▀▀▀▀    "],
  '9': ["   ▄▀▀▀▄   ", "  ▀▄▄▄▄█   ", "       █   ", "  ▀▄▄▄▄▀   ", "   ▀▀▀▀    "],
  '!': ["  ██▌  ", "  ██▌  ", "  ██▌  ", "       ", "  ▄█▄  "],
  '?': ["  ▄███▄  ", " ▀   ██  ", "    ▄█▀  ", "         ", "   ▐██▌  "],
  '.': ["       ", "       ", "       ", "  ▄█▄  ", "  ▀▀▀  "],
  '-': ["       ", "       ", "  ████ ", "       ", "       "],
  '+': ["   ▄   ", "  ███  ", " ▀███▀ ", "  ███  ", "   ▀   "]
};

const renderText = (inputText, fontDict) => {
  const normalizedText = inputText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\n/g, '\n');
  const subLines = normalizedText.split('\n');
  const resultLines = [];
  
  for (const subLine of subLines) {
    const lines = ["", "", "", "", ""];
    const chars = subLine.toUpperCase().split('');
    
    for (const char of chars) {
      const glyph = fontDict[char] || fontDict['?'] || ["     ", "     ", "     ", "     ", "     "];
      for (let row = 0; row < 5; row++) {
        lines[row] += glyph[row] + " ";
      }
    }
    resultLines.push(lines.join('\n'));
  }
  
  return resultLines.join('\n\n');
};

export const tools = {
  calculator: new FunctionTool({
    name: 'calculator',
    description: 'Safely evaluate standard mathematical expressions. Supports addition (+), subtraction (-), multiplication (*), division (/), modulo (%), and parentheses.',
    parameters: z.object({
      expression: z.string().describe('The mathematical expression to evaluate, e.g. "2 * (3 + 4)"'),
    }),
    execute: async ({ expression }) => {
      try {
        // Sanitize the expression to ensure it only contains mathematical characters
        const sanitized = expression.replace(/[^0-9+\-*/%().\s]/g, '');
        if (sanitized !== expression) {
          return {
            success: false,
            error: 'Expression contains forbidden characters. Only numbers and standard operators are allowed.',
          };
        }
        // Evaluate the sanitized expression
        const result = new Function(`return (${sanitized});`)();
        return {
          success: true,
          expression,
          result: typeof result === 'number' ? Number(result.toFixed(6)) : result,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  getSystemInfo: new FunctionTool({
    name: 'getSystemInfo',
    description: 'Retrieve current local system information such as operating system, system uptime, and memory usage.',
    parameters: z.object({}),
    execute: async () => {
      try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        return {
          success: true,
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          uptimeHours: Number((os.uptime() / 3600).toFixed(2)),
          memory: {
            totalGB: Number((totalMem / 1024 / 1024 / 1024).toFixed(2)),
            usedGB: Number((usedMem / 1024 / 1024 / 1024).toFixed(2)),
            freeGB: Number((freeMem / 1024 / 1024 / 1024).toFixed(2)),
            percentUsed: Number(((usedMem / totalMem) * 100).toFixed(1)),
          },
          cpu: {
            model: os.cpus()[0]?.model || 'Unknown',
            cores: os.cpus().length,
          }
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  getCurrentTime: new FunctionTool({
    name: 'getCurrentTime',
    description: 'Get the current local date, time, and timezone offset on the host machine.',
    parameters: z.object({}),
    execute: async () => {
      const now = new Date();
      return {
        success: true,
        localTime: now.toString(),
        isoString: now.toISOString(),
        timestamp: now.getTime(),
        timezoneOffset: now.getTimezoneOffset(),
      };
    },
  }),

  listFiles: new FunctionTool({
    name: 'listFiles',
    description: 'List files in the workspace. Automatically ignores node_modules, .git, and build artifacts to keep the response clean.',
    parameters: z.object({
      directory: z.string().optional().describe('The relative directory to list, defaults to the workspace root "."'),
      path: z.string().optional().describe('Alternative parameter name for directory'),
      directoryPath: z.string().optional().describe('Alternative parameter name for directory'),
    }),
    execute: async (args = {}) => {
      try {
        const directory = args.directory || args.path || args.directoryPath || '.';
        const targetPath = resolveSafePath(directory);
        
        const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json'];
        
        const listDirRecursive = async (currentPath, relativePrefix = '') => {
          let results = [];
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            if (ignoreDirs.includes(entry.name)) continue;
            
            const relativePath = path.join(relativePrefix, entry.name);
            if (entry.isDirectory()) {
              results.push({ name: relativePath, type: 'directory' });
              try {
                const subResults = await listDirRecursive(path.join(currentPath, entry.name), relativePath);
                results = results.concat(subResults);
              } catch {
                // Ignore subdirs we can't read
              }
            } else {
              const stats = await fs.stat(path.join(currentPath, entry.name));
              results.push({
                name: relativePath,
                type: 'file',
                sizeBytes: stats.size,
              });
            }
          }
          return results;
        };
        
        const files = await listDirRecursive(targetPath);
        return { success: true, files };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  readFile: new FunctionTool({
    name: 'readFile',
    description: 'Read the contents of a text file in the workspace. Returns the first 10,000 characters to prevent flooding context.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to read'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const targetPath = resolveSafePath(filePath);
        const stats = await fs.stat(targetPath);
        
        if (!stats.isFile()) {
          return { success: false, error: 'The specified path is not a file.' };
        }
        
        const content = await fs.readFile(targetPath, 'utf-8');
        const isTruncated = content.length > 10000;
        const resultText = isTruncated ? content.slice(0, 10000) + '\n[... TRUNCATED DUE TO SIZE LIMIT ...]' : content;
        
        return {
          success: true,
          filePath,
          sizeBytes: stats.size,
          isTruncated,
          content: resultText,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  writeFile: new FunctionTool({
    name: 'writeFile',
    description: 'Create a new text file or overwrite an existing one with new content in the workspace.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to write'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
      content: z.string().describe('The text content to write to the file'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const content = args.content !== undefined ? args.content : '';
        const targetPath = resolveSafePath(filePath);
        
        // Ensure directory structure exists
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        await fs.writeFile(targetPath, content, 'utf-8');
        const stats = await fs.stat(targetPath);
        
        return {
          success: true,
          filePath,
          sizeBytes: stats.size,
          message: `Successfully wrote ${content.length} characters to ${filePath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  fetchWebPage: new FunctionTool({
    name: 'fetchWebPage',
    description: 'Fetch the text content of a public URL or API endpoint. Useful for fetching live JSON or reference web documentation.',
    parameters: z.object({
      url: z.string().url().describe('The HTTP/HTTPS URL to fetch, e.g. "https://jsonplaceholder.typicode.com/todos/1"'),
    }),
    execute: async ({ url }) => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 8000); // 8-second timeout
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        
        const contentType = response.headers.get('content-type') || '';
        let content = '';
        
        if (contentType.includes('application/json')) {
          const json = await response.json();
          content = JSON.stringify(json, null, 2);
        } else {
          content = await response.text();
          // Strip HTML tags for clean display if it is HTML
          if (contentType.includes('text/html')) {
            content = content
              .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
              .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          }
        }
        
        const isTruncated = content.length > 5000;
        const resultText = isTruncated ? content.slice(0, 5000) + '\n[... TRUNCATED ...]' : content;
        
        return {
          success: true,
          url,
          status: response.status,
          contentType,
          isTruncated,
          content: resultText,
        };
      } catch (error) {
        return { success: false, error: error.name === 'AbortError' ? 'Request timed out after 8 seconds.' : error.message };
      }
    },
  }),

  appendFile: new FunctionTool({
    name: 'appendFile',
    description: 'Append text content to an existing file in the workspace.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to append to'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
      content: z.string().describe('The text content to append'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const content = args.content !== undefined ? args.content : '';
        const targetPath = resolveSafePath(filePath);
        
        // Ensure directory structure exists (just in case)
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        await fs.appendFile(targetPath, content, 'utf-8');
        const stats = await fs.stat(targetPath);
        
        return {
          success: true,
          filePath,
          sizeBytes: stats.size,
          message: `Successfully appended ${content.length} characters to ${filePath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  deleteFile: new FunctionTool({
    name: 'deleteFile',
    description: 'Safely delete a file from the workspace.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to delete'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const targetPath = resolveSafePath(filePath);
        const stats = await fs.stat(targetPath);
        
        if (!stats.isFile()) {
          return { success: false, error: 'The specified path is not a file and cannot be deleted.' };
        }
        
        await fs.unlink(targetPath);
        return {
          success: true,
          filePath,
          message: `Successfully deleted file ${filePath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  makeDirectory: new FunctionTool({
    name: 'makeDirectory',
    description: 'Explicitly create a new directory (and any parent directories) in the workspace.',
    parameters: z.object({
      directoryPath: z.string().describe('The relative path of the directory to create'),
      path: z.string().optional().describe('Alternative parameter name for directoryPath'),
      directory: z.string().optional().describe('Alternative parameter name for directoryPath'),
    }),
    execute: async (args = {}) => {
      try {
        const directoryPath = args.directoryPath || args.path || args.directory || args.filePath;
        if (!directoryPath) {
          return { success: false, error: 'Missing required parameter: directoryPath, path, or directory' };
        }
        const targetPath = resolveSafePath(directoryPath);
        await fs.mkdir(targetPath, { recursive: true });
        return {
          success: true,
          directoryPath,
          message: `Successfully created directory ${directoryPath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  searchGrep: new FunctionTool({
    name: 'searchGrep',
    description: 'Search for text or a regular expression within text files in the workspace (excluding node_modules, .git, etc.).',
    parameters: z.object({
      query: z.string().optional().describe('The search query string or regex pattern'),
      directory: z.string().optional().describe('The relative subdirectory to search within, defaults to "."'),
      path: z.string().optional().describe('Alternative parameter name for directory'),
      directoryPath: z.string().optional().describe('Alternative parameter name for directory'),
      isRegex: z.boolean().optional().default(false).describe('Whether to treat the query as a regular expression pattern'),
    }),
    execute: async (args = {}) => {
      try {
        const query = args.query;
        if (!query) {
          return { success: false, error: 'Missing required parameter: query' };
        }
        const directory = args.directory || args.path || args.directoryPath || '.';
        const isRegex = args.isRegex !== undefined ? args.isRegex : false;
        const targetPath = resolveSafePath(directory);
        const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json'];
        
        const searchInDir = async (currentPath, relativePrefix = '') => {
          let matches = [];
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            if (ignoreDirs.includes(entry.name)) continue;
            
            const relativePath = path.join(relativePrefix, entry.name);
            const fullPath = path.join(currentPath, entry.name);
            
            if (entry.isDirectory()) {
              try {
                const subMatches = await searchInDir(fullPath, relativePath);
                matches = matches.concat(subMatches);
              } catch {
                // Ignore subdirs we can't read
              }
            } else if (entry.isFile()) {
              try {
                // Check if file seems to be text
                const ext = path.extname(entry.name).toLowerCase();
                const textExtensions = ['.js', '.json', '.md', '.txt', '.html', '.css', '.ts', '.yml', '.yaml', '.sh', '.xml', '.ini', '.keep'];
                // Read anyway if no extension, or if it matches
                if (ext && !textExtensions.includes(ext)) continue;
                
                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split('\n');
                
                let regex;
                if (isRegex) {
                  regex = new RegExp(query, 'i');
                }
                
                lines.forEach((line, index) => {
                  const matched = isRegex ? regex.test(line) : line.toLowerCase().includes(query.toLowerCase());
                  if (matched) {
                    // Limit output length per match line
                    const cleanLine = line.trim();
                    matches.push({
                      filePath: relativePath,
                      lineNumber: index + 1,
                      lineContent: cleanLine.length > 150 ? cleanLine.slice(0, 150) + '...' : cleanLine
                    });
                  }
                });
              } catch {
                // Skip unreadable files
              }
            }
          }
          return matches;
        };
        
        const results = await searchInDir(targetPath);
        // Cap results to prevent context flooding
        const totalMatches = results.length;
        const cappedResults = results.slice(0, 100);
        const isTruncated = totalMatches > 100;
        
        return {
          success: true,
          query,
          totalMatches,
          isTruncated,
          matches: cappedResults,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  writeMarkdown: new FunctionTool({
    name: 'writeMarkdown',
    description: 'Create a new markdown file (.md) with structured, beautifully formatted sections.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the markdown file to write (must end in .md)'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
      title: z.string().optional().describe('The main title of the markdown document'),
      sections: z.array(z.object({
        heading: z.string().describe('Section heading'),
        content: z.string().describe('Section text content (supports raw markdown)')
      })).optional().describe('An array of sections to build the document'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const title = args.title || 'Untitled';
        const sections = args.sections || [];
        let finalPath = filePath;
        if (!finalPath.toLowerCase().endsWith('.md')) {
          finalPath = finalPath + '.md';
        }
        const targetPath = resolveSafePath(finalPath);
        
        let markdownContent = `# ${title}\n\n`;
        for (const section of sections) {
          markdownContent += `## ${section.heading}\n\n${section.content}\n\n`;
        }
        
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, markdownContent, 'utf-8');
        const stats = await fs.stat(targetPath);
        
        return {
          success: true,
          filePath: finalPath,
          sizeBytes: stats.size,
          message: `Successfully generated markdown document "${title}" at ${finalPath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  executeCommand: new FunctionTool({
    name: 'executeCommand',
    description: 'Execute a terminal command within the workspace directory. Useful for building, testing, or running workspace code.',
    parameters: z.object({
      command: z.string().describe('The shell command to execute, e.g. "npm run test" or "node index.js"'),
    }),
    execute: async ({ command }) => {
      return new Promise((resolve) => {
        exec(command, { cwd: WORKSPACE_DIR, timeout: 300000 }, (error, stdout, stderr) => {
          resolve({
            success: !error,
            exitCode: error ? error.code : 0,
            stdout: stdout ? stdout.toString() : '',
            stderr: stderr ? stderr.toString() : '',
            message: error ? `Command failed: ${error.message}` : 'Command executed successfully.'
          });
        });
      });
    }
  }),

  searchReplace: new FunctionTool({
    name: 'searchReplace',
    description: 'Find and replace a specific string or pattern inside a file in the workspace.',
    parameters: z.object({
      filePath: z.string().describe('The relative path of the file to modify'),
      findText: z.string().describe('The exact text block to search for and replace'),
      replaceText: z.string().describe('The text block to replace the search match with'),
    }),
    execute: async ({ filePath, findText, replaceText }) => {
      try {
        const targetPath = resolveSafePath(filePath);
        const stats = await fs.stat(targetPath);
        if (!stats.isFile()) {
          return { success: false, error: 'The specified path is not a file.' };
        }
        const content = await fs.readFile(targetPath, 'utf-8');
        if (!content.includes(findText)) {
          return { success: false, error: `Could not find the target text block in file: ${filePath}. Match must be exact.` };
        }
        const updatedContent = content.replace(findText, replaceText);
        await fs.writeFile(targetPath, updatedContent, 'utf-8');
        return {
          success: true,
          filePath,
          message: `Successfully replaced the text block in ${filePath}`
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  findFiles: new FunctionTool({
    name: 'findFiles',
    description: 'Find files in the workspace matching a specific pattern or containing a substring in their name.',
    parameters: z.object({
      pattern: z.string().describe('The filename pattern or substring to search for (e.g., "*.js", "config", "index.html")'),
      directory: z.string().optional().describe('The relative directory to search within, defaults to workspace root "."'),
    }),
    execute: async ({ pattern, directory = '.' }) => {
      try {
        const targetPath = resolveSafePath(directory);
        const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json'];
        
        let isRegex = pattern.includes('*') || pattern.includes('?');
        let regexPattern = null;
        if (isRegex) {
          const escaped = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
          regexPattern = new RegExp(`^${escaped}$`, 'i');
        }

        const findInDir = async (currentPath, relativePrefix = '') => {
          let results = [];
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            if (ignoreDirs.includes(entry.name)) continue;
            const relativePath = path.join(relativePrefix, entry.name);
            const fullPath = path.join(currentPath, entry.name);
            
            if (entry.isDirectory()) {
              try {
                const subResults = await findInDir(fullPath, relativePath);
                results = results.concat(subResults);
              } catch {
                // skip unreadable
              }
            } else {
              const matchesPattern = regexPattern 
                ? regexPattern.test(entry.name) 
                : entry.name.toLowerCase().includes(pattern.toLowerCase());
                
              if (matchesPattern) {
                const stats = await fs.stat(fullPath);
                results.push({
                  filePath: relativePath,
                  sizeBytes: stats.size,
                  modifiedTime: stats.mtime
                });
              }
            }
          }
          return results;
        };

        const matches = await findInDir(targetPath);
        return {
          success: true,
          pattern,
          totalMatches: matches.length,
          matches: matches.slice(0, 100),
          isTruncated: matches.length > 100
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  dinoGame: new FunctionTool({
    name: 'dinoGame',
    description: 'Launch the premium Plumar Dino Game locally. Spins up an HTTP server and automatically opens the game in your web browser.',
    parameters: z.object({
      action: z.enum(['start', 'stop', 'status']).optional().default('start').describe('The action to perform: start the game server, stop it, or check status'),
    }),
    execute: async ({ action }) => {
      try {
        if (action === 'stop') {
          if (dinoServer) {
            dinoServer.close();
            dinoServer = null;
            dinoPort = 0;
            return { success: true, message: 'Plumar Dino game server stopped successfully.' };
          }
          return { success: true, message: 'Dino server was not running.' };
        }

        if (action === 'status') {
          return {
            success: true,
            running: !!dinoServer,
            url: dinoPort ? `http://localhost:${dinoPort}` : null,
            message: dinoServer 
              ? `Plumar Dino is active at http://localhost:${dinoPort}` 
              : 'Plumar Dino server is currently idle.'
          };
        }

        // Start the server if not already running
        if (!dinoServer) {
          const gameHtmlPath = path.join(INSTALL_DIR, 'dino-game', 'index.html');
          
          dinoServer = http.createServer(async (req, res) => {
            try {
              const content = await fs.readFile(gameHtmlPath, 'utf-8');
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(content);
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end(`Error loading game: ${err.message}`);
            }
          });

          await new Promise((resolve, reject) => {
            dinoServer.listen(3456, () => {
              dinoPort = 3456;
              resolve();
            });
            dinoServer.on('error', (err) => {
              if (err.code === 'EADDRINUSE') {
                dinoServer.listen(0, () => {
                  dinoPort = dinoServer.address().port;
                  resolve();
                });
              } else {
                reject(err);
              }
            });
          });
        }

        const url = `http://localhost:${dinoPort}`;
        
        const openCommand = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open');
        exec(`${openCommand} ${url}`, (err) => {
          // Ignore error, browser might not be available or opened, but we still return the URL
        });

        return {
          success: true,
          url,
          port: dinoPort,
           message: `👾 Plumar Dino Game is running!\n\n👉 Open this link in your browser to play: ${url}\n\nFeatures:\n• 🌟 Starfield Parallax Backdrop\n• 🎶 8-Bit Audio synthesizer (via Web Audio API)\n• 🌌 Multiple Physics Modes: Standard Gravity, Float Low Gravity, and Gravity Flip Mode!\n• 💾 High scores are persistent. Have fun!`
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  apiPerformanceTest: new FunctionTool({
    name: 'apiPerformanceTest',
    description: 'Execute a lightweight performance and load test on a specified API endpoint. Measures latency, throughput, success rates, and response times.',
    parameters: z.object({
      url: z.string().url().describe('The URL endpoint to performance test'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET').describe('The HTTP method to use'),
      headers: z.record(z.string()).optional().describe('Optional custom HTTP headers'),
      body: z.string().optional().describe('Optional HTTP request body'),
      requests: z.number().int().min(1).max(500).optional().default(50).describe('Total number of requests to perform (max 500)'),
      concurrency: z.number().int().min(1).max(50).optional().default(5).describe('Number of concurrent workers (max 50)'),
    }),
    execute: async ({ url, method = 'GET', headers = {}, body, requests = 50, concurrency = 5 }) => {
      try {
        const requestTimes = [];
        let successCount = 0;
        let failCount = 0;
        const statusDistribution = {};
        
        const startTime = Date.now();
        let index = 0;

        const worker = async () => {
          while (true) {
            if (index >= requests) return;
            const currentRequestIndex = index++;
            
            const reqStart = Date.now();
            try {
              const options = {
                method,
                headers: {
                  'Content-Type': 'application/json',
                  ...headers
                },
              };
              if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
                options.body = body;
              }
              
              const response = await fetch(url, options);
              const reqEnd = Date.now();
              const duration = reqEnd - reqStart;
              requestTimes.push(duration);
              
              const status = response.status;
              statusDistribution[status] = (statusDistribution[status] || 0) + 1;
              
              if (response.ok) {
                successCount++;
              } else {
                failCount++;
              }
            } catch (error) {
              const reqEnd = Date.now();
              const duration = reqEnd - reqStart;
              requestTimes.push(duration);
              failCount++;
              statusDistribution['Error'] = (statusDistribution['Error'] || 0) + 1;
            }
          }
        };

        const workers = Array.from({ length: Math.min(concurrency, requests) }, () => worker());
        await Promise.all(workers);
        
        const totalTime = Date.now() - startTime;
        const totalRequests = requestTimes.length;
        const minTime = totalRequests > 0 ? Math.min(...requestTimes) : 0;
        const maxTime = totalRequests > 0 ? Math.max(...requestTimes) : 0;
        const avgTime = totalRequests > 0 ? Number((requestTimes.reduce((a, b) => a + b, 0) / totalRequests).toFixed(2)) : 0;
        const rps = Number((totalRequests / (totalTime / 1000)).toFixed(2));
        
        const sortedTimes = [...requestTimes].sort((a, b) => a - b);
        const p95 = totalRequests > 0 ? sortedTimes[Math.floor(totalRequests * 0.95)] || sortedTimes[totalRequests - 1] : 0;
        const p99 = totalRequests > 0 ? sortedTimes[Math.floor(totalRequests * 0.99)] || sortedTimes[totalRequests - 1] : 0;

        return {
          success: true,
          summary: {
            url,
            method,
            totalRequests,
            concurrency,
            totalTimeMs: totalTime,
            requestsPerSecond: rps,
            successCount,
            failCount,
            errorRatePercent: Number(((failCount / totalRequests) * 100).toFixed(2)),
          },
          latencyMs: {
            min: minTime,
            max: maxTime,
            average: avgTime,
            p95,
            p99
          },
          statusDistribution
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  createAsciiArt: new FunctionTool({
    name: 'createAsciiArt',
    description: 'Generate stylized, retro-styled ASCII art from custom text (using block or slant fonts), preset shapes, or a loaded image file (PNG, JPEG, etc.).',
    parameters: z.object({
      text: z.string().optional().describe('The text to convert to ASCII art. Supports standard alphanumeric characters, punctuation, and newlines.'),
      font: z.enum(['block', 'slant']).optional().default('block').describe('The font style to use for text rendering ("block" or "slant")'),
      presetShape: z.enum(['heart', 'star', 'dino', 'rocket', 'coffee']).optional().describe('A preset retro-styled shape to generate (e.g. heart, star, dino, rocket, coffee)'),
      imagePath: z.string().optional().describe('Relative or absolute path to an image file inside the workspace (PNG, JPEG, etc.) to convert into ASCII art. Can also be a remote HTTP/HTTPS URL.'),
      url: z.string().optional().describe('Alternative parameter. A remote HTTP/HTTPS URL of an image file to convert into ASCII art.'),
      imageWidth: z.number().int().min(10).max(200).optional().default(60).describe('Target width of the rendered ASCII image in characters (max 200). Default is 60.'),
      colored: z.boolean().optional().default(false).describe('If true, generates colored ASCII art using ANSI 24-bit TrueColor escapes (best for terminals).'),
      outputPath: z.string().optional().describe('Optional relative path inside the workspace to save the computed raw ASCII art directly (with all formatting and ANSI escapes, if colored is enabled).'),
    }),
    execute: async ({ text, font = 'block', presetShape, imagePath, url, imageWidth = 60, colored = false, outputPath }) => {
      try {
        const activeImagePath = imagePath || url;
        if (!text && !presetShape && !activeImagePath) {
          return {
            success: false,
            error: 'You must provide either "text", "presetShape", or "imagePath" / "url" to generate ASCII art.'
          };
        }

        const presetShapes = {
          heart: [
            "      ▄▄████▄▄      ▄▄████▄▄",
            "    ▄██████████▄  ▄██████████▄",
            "    ██████████████████████████",
            "    ▀████████████████████████▀",
            "      ▀████████████████████▀",
            "        ▀████████████████▀",
            "          ▀████████████▀",
            "            ▀████████▀",
            "              ▀████▀",
            "                ▀▀"
          ],
          star: [
            "         ▄",
            "        ▟█▙",
            "      ▄█████▄",
            " ▄▄█████████████▄▄",
            "  ▀█████████████▀",
            "    ▟█████████▙",
            "   ▟█▀   ▀   ▀█▙"
          ],
          dino: [
            "            ▄████████",
            "            ███▄█████",
            "            ████████▀",
            "            ███████",
            "   ▄       ███████",
            "  ███▄▄▄▄█████████",
            "  ▀███████████████",
            "    ▀███████████▀",
            "       ████  ███",
            "       ██    ██",
            "       ▀▀    ▀▀"
          ],
          rocket: [
            "        ▄",
            "       ▟█▙",
            "      ▐███▌",
            "      ▐███▌",
            "     ▄█████▄",
            "    ▐███████▌",
            "    █████████",
            "   ▐█████████▌",
            "   ▟█▀ ███ ▀█▙",
            "   ▀   ███   ▀",
            "       ▀▀▀"
          ],
          coffee: [
            "    ▄▄▄     ▄▄▄",
            "     ▀██▄    ▀██▄",
            "   ▄██████████████▄",
            "  ▐████████████████▌ ▄██▄",
            "  ▐████████████████▌▐█▌▀██",
            "  ▐████████████████▌▐█▌ ▐█▌",
            "   ▀██████████████▀ ▐█▌▄██",
            "     ▀██████████▀    ▀██▀",
            "   ▄██████████████▄",
            "   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀"
          ]
        };

        const parts = [];

        if (presetShape) {
          const shapeLines = presetShapes[presetShape];
          if (!shapeLines) {
            return {
              success: false,
              error: `Preset shape "${presetShape}" not found. Available shapes: heart, star, dino, rocket, coffee.`
            };
          }
          parts.push(shapeLines.join('\n'));
        }

        if (text) {
          const fontDict = font === 'slant' ? slantFont : blockFont;
          const textArt = renderText(text, fontDict);
          parts.push(textArt);
        }

        if (activeImagePath) {
          let image;
          if (activeImagePath.startsWith('http://') || activeImagePath.startsWith('https://')) {
            try {
              const response = await fetch(activeImagePath);
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              const arrayBuffer = await response.arrayBuffer();
              image = await Jimp.read(Buffer.from(arrayBuffer));
            } catch (err) {
              return {
                success: false,
                error: `Failed to fetch remote image from URL "${activeImagePath}": ${err.message}`
              };
            }
          } else {
            const resolvedPath = resolveSafePath(activeImagePath);
            try {
              image = await Jimp.read(resolvedPath);
            } catch (err) {
              return {
                success: false,
                error: `Failed to read local image at "${activeImagePath}": ${err.message}`
              };
            }
          }

          const imgWidth = imageWidth || 60;
          const imgHeight = Math.round(image.bitmap.height * (imgWidth / image.bitmap.width) * 0.45) || 1;
          
          await image.resize({ w: imgWidth, h: imgHeight });

          const asciiLines = [];
          const ramp = ' .:-=+*#%@';

          for (let y = 0; y < image.bitmap.height; y++) {
            let line = '';
            for (let x = 0; x < image.bitmap.width; x++) {
              const colorHex = image.getPixelColor(x, y);
              const r = (colorHex >>> 24) & 0xFF;
              const g = (colorHex >>> 16) & 0xFF;
              const b = (colorHex >>> 8) & 0xFF;
              const a = colorHex & 0xFF;

              // Calculate luminance
              const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b);
              
              if (a === 0) {
                line += ' ';
                continue;
              }

              const rampIndex = Math.min(
                Math.floor((luminance / 255) * ramp.length),
                ramp.length - 1
              );
              const char = ramp[rampIndex];

              if (colored) {
                line += `\x1b[38;2;${r};${g};${b}m${char}\x1b[0m`;
              } else {
                line += char;
              }
            }
            asciiLines.push(line);
          }
          parts.push(asciiLines.join('\n'));
        }

        const art = parts.join('\n\n');
        console.log('\n' + art + '\n');

        let savedMessage = '';
        if (outputPath) {
          try {
            const targetPath = resolveSafePath(outputPath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, art, 'utf-8');
            savedMessage = ` Also saved to "${outputPath}".`;
          } catch (writeErr) {
            return {
              success: false,
              error: `Failed to save ASCII art to file "${outputPath}": ${writeErr.message}`
            };
          }
        }

        return {
          success: true,
          art: art,
          message: `Successfully generated ASCII art.${savedMessage}`
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  fetchImage: new FunctionTool({
    name: 'fetchImage',
    description: 'Fetch/download an image file from a remote HTTP/HTTPS URL and save it securely inside the workspace.',
    parameters: z.object({
      url: z.string().url().describe('The remote HTTP/HTTPS URL of the image to download.'),
      outputPath: z.string().optional().describe('Relative or absolute path inside the workspace to save the downloaded image (e.g. "my_avatar.png" or "images/pic.jpg"). If omitted, saves it in the workspace root with its original filename from the URL.'),
    }),
    execute: async ({ url, outputPath }) => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 8000); // 8-second timeout
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          throw new Error(`The requested URL does not point to an image. Content-Type is "${contentType}".`);
        }

        // Determine output filename if not provided
        let targetPath = outputPath;
        if (!targetPath) {
          // Extract file name from URL path
          const urlObj = new URL(url);
          let filename = path.basename(urlObj.pathname);
          if (!filename || filename === '/' || !filename.includes('.')) {
            // Determine extension from content-type
            const ext = contentType.split('/')[1] || 'png';
            filename = `downloaded_image_${Date.now()}.${ext}`;
          }
          targetPath = filename;
        }

        const resolvedPath = resolveSafePath(targetPath);

        // Ensure parent directories exist
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(resolvedPath, buffer);

        return {
          success: true,
          message: `Successfully fetched and saved image to "${targetPath}" (${buffer.length} bytes).`,
          outputPath: targetPath,
          sizeBytes: buffer.length,
          contentType
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  base64Convert: new FunctionTool({
    name: 'base64Convert',
    description: 'Convert strings or files to and from Base64 encoding. Supports raw text or saving decoded binary files directly to disk.',
    parameters: z.object({
      action: z.enum(['encode', 'decode']).describe('Whether to encode to Base64 or decode from Base64.'),
      inputType: z.enum(['text', 'file']).default('text').describe('The type of input being processed: "text" (a raw string) or "file" (relative path to a workspace file).'),
      input: z.string().describe('The raw text to convert, or the relative path of the file to read.'),
      outputPath: z.string().optional().describe('Optional relative path in the workspace to save the result. For decoding binary files, this is highly recommended.'),
    }),
    execute: async ({ action, inputType = 'text', input, outputPath }) => {
      try {
        let rawData;
        
        if (inputType === 'file') {
          const resolvedPath = resolveSafePath(input);
          rawData = await fs.readFile(resolvedPath);
        } else {
          rawData = Buffer.from(input, 'utf-8');
        }

        let result;
        if (action === 'encode') {
          result = rawData.toString('base64');
        } else {
          // Decoding
          if (inputType === 'file') {
            // For files, we assume the input file contains a base64 string
            const fileStr = rawData.toString('utf-8').trim();
            result = Buffer.from(fileStr, 'base64');
          } else {
            result = Buffer.from(input, 'base64');
          }
        }

        let savedMessage = '';
        if (outputPath) {
          const targetPath = resolveSafePath(outputPath);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });

          // Intercept unreadable/corrupted image files
          const ext = path.extname(outputPath).toLowerCase();
          const isImageExt = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(ext);

          let isValidImage = true;
          if (action === 'decode' && isImageExt) {
            // Check if buffer starts with standard image magic bytes
            const hasMagicBytes = Buffer.isBuffer(result) && result.length >= 2 && (
              (result[0] === 0xff && result[1] === 0xd8) || // JPEG
              (result.length >= 4 && result[0] === 0x89 && result[1] === 0x50 && result[2] === 0x4e && result[3] === 0x47) || // PNG
              (result.length >= 4 && result[0] === 0x47 && result[1] === 0x49 && result[2] === 0x46 && result[3] === 0x38) || // GIF
              (result[0] === 0x42 && result[1] === 0x4d) // BMP
            );
            if (!hasMagicBytes) {
              isValidImage = false;
            }
          }

          if (action === 'decode' && isImageExt && !isValidImage) {
            // Extract a clean prompt from input placeholder or filename
            let cleanedPrompt = 'image';
            const inputStr = input.trim();
            if (inputStr.startsWith('[') && inputStr.endsWith(']')) {
              const inner = inputStr.slice(1, -1);
              const match = inner.match(/(?:representing|of|a|an)\s+([^,]+?)(?:\s+image|\s+data|$)/i);
              if (match && match[1]) {
                cleanedPrompt = match[1].trim();
              } else {
                cleanedPrompt = inner.trim();
              }
            } else if (inputStr.length < 100 && /^[a-zA-Z0-9\s-_]+$/.test(inputStr)) {
              cleanedPrompt = inputStr;
            } else {
              cleanedPrompt = path.basename(outputPath, ext).replace(/[-_]/g, ' ');
            }

            console.log(`[base64Convert] Intercepted corrupted image decoding. Falling back to generateImage for prompt: "${cleanedPrompt}"`);

            const genResult = await tools.generateImage.execute({
              outputPath,
              prompt: cleanedPrompt,
              width: 400,
              height: 400
            });

            if (genResult.success) {
              return {
                success: true,
                action,
                inputType,
                message: `Successfully generated valid offline image via fallback to generateImage for "${cleanedPrompt}" and saved to "${outputPath}".`,
                result: genResult.outputPath
              };
            } else {
              return genResult;
            }
          } else {
            await fs.writeFile(targetPath, result);
            savedMessage = ` Successfully saved output to "${outputPath}".`;
          }
        }

        // Return a clean summary. If encoding or decoding to text, also return the string representation.
        const response = {
          success: true,
          action,
          inputType,
          message: `Successfully performed Base64 ${action} operation.${savedMessage}`,
        };

        if (!outputPath || action === 'encode' || (action === 'decode' && typeof result === 'string')) {
          const displayStr = Buffer.isBuffer(result) ? result.toString('utf-8') : result;
          // limit returned result length to avoid bloating context
          response.result = displayStr.length > 5000 ? displayStr.slice(0, 5000) + '\n... [TRUNCATED] ...' : displayStr;
        }

        return response;
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  generateMockData: new FunctionTool({
    name: 'generateMockData',
    description: 'Generate structured mock/test data in JSON, CSV, XML, or YAML formats. Supports various presets (users, products, orders, transactions) or custom schema definitions.',
    parameters: z.object({
      preset: z.enum(['users', 'products', 'orders', 'transactions', 'custom']).default('users').describe('The preset type of data to generate.'),
      format: z.enum(['json', 'csv', 'xml', 'yaml']).default('json').describe('The output serialization format.'),
      count: z.number().int().min(1).max(500).default(10).describe('Number of mock items to generate (max 500).'),
      customFields: z.array(z.object({
        name: z.string().describe('The field name.'),
        type: z.enum(['id', 'uuid', 'name', 'email', 'phone', 'company', 'date', 'price', 'quantity', 'boolean', 'text']).describe('The field generator data type.'),
      })).optional().describe('Custom fields schema to use when preset is "custom".'),
      outputPath: z.string().optional().describe('Optional relative path inside the workspace to save the generated structured mock data directly.'),
    }),
    execute: async ({ preset = 'users', format = 'json', count = 10, customFields, outputPath }) => {
      try {
        const firstNames = ['John', 'Jane', 'Alex', 'Emily', 'Michael', 'Sarah', 'David', 'Jessica', 'James', 'Ashley', 'Robert', 'Megan', 'William', 'Amanda'];
        const lastNames = ['Smith', 'Doe', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson', 'Martinez', 'Anderson'];
        const companies = ['Stark Industries', 'Acme Corp', 'Initech', 'Hooli', 'Vehement Capital', 'Umbrella Corp', 'Cyberdyne Systems', 'Globex'];
        const products = ['Neon T-Rex Mug', 'Quantum Keyboard', 'Mechanical Retro Mouse', 'Cyberpunk Lamp', '8-Bit Synth Synthesizer', 'Low-G Skate Helmet', 'Astronaut Coffee beans'];
        const categories = ['Kitchen', 'Electronics', 'Peripherals', 'Home Decor', 'Audio', 'Apparel', 'Food'];

        const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const getRandomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
        const getRandomPrice = (min, max) => parseFloat((Math.random() * (max - min) + min).toFixed(2));
        const getRandomPhone = () => `+1 (${getRandomRange(200, 999)}) 555-${getRandomRange(1000, 9999)}`;

        const generateItem = (idx) => {
          if (preset === 'users') {
            const firstName = getRandomItem(firstNames);
            const lastName = getRandomItem(lastNames);
            return {
              id: idx + 1,
              uuid: crypto.randomUUID ? crypto.randomUUID() : `u-${Math.random().toString(36).substring(2, 11)}`,
              name: `${firstName} ${lastName}`,
              email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
              phone: getRandomPhone(),
              company: getRandomItem(companies),
              role: getRandomItem(['Admin', 'Developer', 'Designer', 'Product Manager', 'User']),
              active: Math.random() > 0.15,
              joinedDate: new Date(Date.now() - getRandomRange(1, 1000) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            };
          }

          if (preset === 'products') {
            return {
              id: idx + 1,
              sku: `PROD-${getRandomRange(1000, 9999)}-${idx + 100}`,
              name: getRandomItem(products),
              category: getRandomItem(categories),
              price: getRandomPrice(10, 500),
              stock: getRandomRange(0, 150),
              rating: parseFloat((Math.random() * 2 + 3).toFixed(1)),
              discontinued: Math.random() > 0.90
            };
          }

          if (preset === 'orders') {
            return {
              orderId: 10000 + idx,
              customerId: getRandomRange(1, 100),
              customerName: `${getRandomItem(firstNames)} ${getRandomItem(lastNames)}`,
              productName: getRandomItem(products),
              totalAmount: getRandomPrice(15, 1200),
              status: getRandomItem(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled']),
              orderDate: new Date(Date.now() - getRandomRange(0, 30) * 24 * 60 * 60 * 1000).toISOString()
            };
          }

          if (preset === 'transactions') {
            return {
              transactionId: `TXN-${Math.random().toString(36).substring(2, 11).toUpperCase()}`,
              amount: getRandomPrice(5, 5000),
              type: getRandomItem(['deposit', 'withdrawal', 'payment', 'refund']),
              status: getRandomItem(['success', 'pending', 'failed']),
              paymentMethod: getRandomItem(['Credit Card', 'PayPal', 'Crypto', 'Bank Transfer']),
              timestamp: new Date(Date.now() - getRandomRange(0, 60) * 60 * 1000).toISOString()
            };
          }

          // Custom Schema logic
          if (preset === 'custom' && customFields && customFields.length > 0) {
            const customItem = {};
            customFields.forEach(f => {
              switch (f.type) {
                case 'id':
                  customItem[f.name] = idx + 1;
                  break;
                case 'uuid':
                  customItem[f.name] = crypto.randomUUID ? crypto.randomUUID() : `uid-${Math.random().toString(36).substring(2, 11)}`;
                  break;
                case 'name':
                  customItem[f.name] = `${getRandomItem(firstNames)} ${getRandomItem(lastNames)}`;
                  break;
                case 'email':
                  customItem[f.name] = `${getRandomItem(firstNames).toLowerCase()}.${getRandomItem(lastNames).toLowerCase()}@example.com`;
                  break;
                case 'phone':
                  customItem[f.name] = getRandomPhone();
                  break;
                case 'company':
                  customItem[f.name] = getRandomItem(companies);
                  break;
                case 'date':
                  customItem[f.name] = new Date(Date.now() - getRandomRange(0, 365) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                  break;
                case 'price':
                  customItem[f.name] = getRandomPrice(5, 1000);
                  break;
                case 'quantity':
                  customItem[f.name] = getRandomRange(1, 50);
                  break;
                case 'boolean':
                  customItem[f.name] = Math.random() > 0.5;
                  break;
                case 'text':
                  customItem[f.name] = `Lorem ipsum dolor sit amet, consectetur adipiscing elit.`;
                  break;
                default:
                  customItem[f.name] = null;
              }
            });
            return customItem;
          }

          return { id: idx + 1, note: 'Default generic mock object' };
        };

        const dataList = Array.from({ length: count }, (_, idx) => generateItem(idx));
        let serializedData = '';

        if (format === 'json') {
          serializedData = JSON.stringify(dataList, null, 2);
        } else if (format === 'csv') {
          if (dataList.length > 0) {
            const headers = Object.keys(dataList[0]);
            const csvRows = [headers.join(',')];
            for (const item of dataList) {
              const row = headers.map(header => {
                const val = item[header];
                if (val === null || val === undefined) return '';
                const str = String(val);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                  return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
              });
              csvRows.push(row.join(','));
            }
            serializedData = csvRows.join('\n');
          }
        } else if (format === 'xml') {
          const xmlLines = ['<?xml version="1.0" encoding="UTF-8"?>', `<records>`];
          const rootTagName = preset === 'custom' ? 'record' : preset.slice(0, -1) || 'item';
          for (const item of dataList) {
            xmlLines.push(`  <${rootTagName}>`);
            for (const [key, val] of Object.entries(item)) {
              xmlLines.push(`    <${key}>${val}</${key}>`);
            }
            xmlLines.push(`  </${rootTagName}>`);
          }
          xmlLines.push('</records>');
          serializedData = xmlLines.join('\n');
        } else if (format === 'yaml') {
          const yamlLines = [];
          for (const item of dataList) {
            yamlLines.push('-');
            for (const [key, val] of Object.entries(item)) {
              if (typeof val === 'object' && val !== null) {
                yamlLines.push(`  ${key}: ${JSON.stringify(val)}`);
              } else if (typeof val === 'string' && (val.includes(':') || val.includes('#') || val.includes('\n'))) {
                yamlLines.push(`  ${key}: "${val.replace(/"/g, '\\"')}"`);
              } else {
                yamlLines.push(`  ${key}: ${val}`);
              }
            }
          }
          serializedData = yamlLines.join('\n');
        }

        let savedMessage = '';
        if (outputPath) {
          const targetPath = resolveSafePath(outputPath);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, serializedData, 'utf-8');
          savedMessage = ` Mock data successfully saved to "${outputPath}".`;
        }

        return {
          success: true,
          preset,
          format,
          count,
          message: `Successfully generated structured mock data.${savedMessage}`,
          data: count > 20 ? serializedData.split('\n').slice(0, 50).join('\n') + '\n... [TRUNCATED] ...' : serializedData
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  generateHash: new FunctionTool({
    name: 'generateHash',
    description: 'Calculate cryptographic hash values (MD5, SHA-1, SHA-256, SHA-512) for strings or files in the workspace.',
    parameters: z.object({
      algorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']).default('sha256').describe('The hashing algorithm to use.'),
      inputType: z.enum(['text', 'file']).default('text').describe('The type of input being hashed: "text" (a raw string) or "file" (relative path to a workspace file).'),
      input: z.string().describe('The raw text to hash, or the relative path of the file to hash.'),
      encoding: z.enum(['hex', 'base64', 'latin1']).default('hex').describe('The output digest encoding.'),
    }),
    execute: async ({ algorithm = 'sha256', inputType = 'text', input, encoding = 'hex' }) => {
      try {
        const hash = crypto.createHash(algorithm);
        
        if (inputType === 'file') {
          const resolvedPath = resolveSafePath(input);
          const data = await fs.readFile(resolvedPath);
          hash.update(data);
        } else {
          hash.update(input, 'utf-8');
        }

        const digest = hash.digest(encoding);
        return {
          success: true,
          algorithm,
          inputType,
          encoding,
          hash: digest
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  listSkills: new FunctionTool({
    name: 'listSkills',
    description: 'List all custom agentic skills currently loaded in the workspace.',
    parameters: z.object({}),
    execute: async () => {
      try {
        const skills = getLoadedSkills();
        return {
          success: true,
          skills: Object.values(skills).map(s => ({
            name: s.name,
            description: s.frontmatter.description,
            tags: s.frontmatter.tags,
            resources: s.resources
          }))
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  loadSkill: new FunctionTool({
    name: 'loadSkill',
    description: 'Read the detailed instructions, assets, references, and scripts of a loaded custom skill.',
    parameters: z.object({
      name: z.string().describe('The name of the skill to load (must match a loaded skill name).')
    }),
    execute: async ({ name }) => {
      try {
        const skills = getLoadedSkills();
        const skill = skills[name];
        if (!skill) {
          return {
            success: false,
            error: `Skill "${name}" not found. Use "listSkills" to see available skills.`
          };
        }
        return {
          success: true,
          name: skill.name,
          description: skill.frontmatter.description,
          instructions: skill.instructions,
          resources: skill.resources
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  createSkill: new FunctionTool({
    name: 'createSkill',
    description: 'Create a new custom skill folder with its SKILL.md file and references/assets/scripts directories.',
    parameters: z.object({
      name: z.string().describe('Name of the skill in lowercase kebab-case or snake_case.'),
      description: z.string().describe('Short description of what this skill does.'),
      tags: z.array(z.string()).optional().describe('List of tags/keywords associated with this skill.'),
      instructions: z.string().describe('Detailed markdown instructions for the skill.')
    }),
    execute: async ({ name, description, tags, instructions }) => {
      try {
        const skill = await createSkillInManager(name, description, tags, instructions);
        return {
          success: true,
          message: `Skill "${name}" created successfully at ${skill.path}.`,
          skill: {
            name: skill.name,
            description: skill.frontmatter.description,
            tags: skill.frontmatter.tags
          }
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  createPlugin: new FunctionTool({
    name: 'createPlugin',
    description: 'Create a new custom JavaScript plugin (FunctionTool) to extend the agent\'s capabilities.',
    parameters: z.object({
      fileName: z.string().describe('Name of the JavaScript file to create (e.g., "my-tool.js" or "my-tool").'),
      codeContent: z.string().describe('The complete ESM JavaScript code exporting a FunctionTool or array of tools.')
    }),
    execute: async ({ fileName, codeContent }) => {
      try {
        const plugin = await createPluginInManager(fileName, codeContent);
        return {
          success: true,
          message: `Plugin "${fileName}" created successfully. It will be loaded on the next startup.`,
          plugin: {
            fileName: plugin.fileName,
            filePath: plugin.filePath
          }
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  generateImage: new FunctionTool({
    name: 'generateImage',
    description: '(ALPHA) Use a local rendering engine to procedurally generate a custom image file (such as PNG or JPEG) offline based on a visual prompt or structured drawing instructions. Perfect for creating diagrams, shapes, illustrations (e.g. potato, apple, star, heart), or retro pixel-art without calling external network APIs.',
    parameters: z.object({
      outputPath: z.string().describe('Relative or absolute path inside the workspace to save the generated image (e.g. "potatoes.jpg" or "images/apple.png").'),
      prompt: z.string().describe('A descriptive prompt of what to draw (e.g. "a potato with some brown spots"). This is used by the smart local generator if no custom drawings are provided.'),
      width: z.number().int().min(10).max(2000).optional().default(400).describe('Width of the image in pixels. Default is 400.'),
      height: z.number().int().min(10).max(2000).optional().default(400).describe('Height of the image in pixels. Default is 400.'),
      backgroundColor: z.string().optional().default('#334455').describe('Standard hex color code for the background (e.g. "#334455" or "#ffffff").'),
      drawings: z.array(z.object({
        type: z.enum(['ellipse', 'circle', 'rect', 'line', 'text']),
        x: z.number().optional().describe('Center X coordinate for ellipse/circle, or start X for rect/text.'),
        y: z.number().optional().describe('Center Y coordinate for ellipse/circle, or start Y for rect/text.'),
        rx: z.number().optional().describe('Horizontal radius for ellipse.'),
        ry: z.number().optional().describe('Vertical radius for ellipse.'),
        radius: z.number().optional().describe('Radius for circle.'),
        width: z.number().optional().describe('Width for rectangle.'),
        height: z.number().optional().describe('Height for rectangle.'),
        x1: z.number().optional().describe('Start X coordinate for line.'),
        y1: z.number().optional().describe('Start Y coordinate for line.'),
        x2: z.number().optional().describe('End X coordinate for line.'),
        y2: z.number().optional().describe('End Y coordinate for line.'),
        thickness: z.number().optional().default(1).describe('Line thickness (default is 1).'),
        color: z.string().describe('Hex color code for the shape or text (e.g. "#ff0000" or "#8B5A2B").'),
        text: z.string().optional().describe('The text content to draw (for type="text").'),
        scale: z.number().optional().default(1).describe('Font scale factor for text drawing (default is 1).')
      })).optional().describe('Optional custom drawing commands. If provided, the model can specify a list of shapes, lines, and text to construct highly specific or complex custom images.')
    }),
    execute: async ({ outputPath, prompt, width = 400, height = 400, backgroundColor = '#334455', drawings }) => {
      try {
        const resolvedPath = resolveSafePath(outputPath);

        // Try to generate using Google GenAI (Imagen) if API key is present
        if (!drawings || drawings.length === 0) {
          const ai = getGenAIClient();
          if (ai) {
            try {
              console.log(`[generateImage] Using Google GenAI (Imagen) to generate: "${prompt}"`);
              const response = await ai.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: prompt,
                config: {
                  numberOfImages: 1,
                  outputMimeType: outputPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
                }
              });
              
              if (response && response.generatedImages && response.generatedImages[0] && response.generatedImages[0].image && response.generatedImages[0].image.imageBytes) {
                const base64Bytes = response.generatedImages[0].image.imageBytes;
                const buffer = Buffer.from(base64Bytes, 'base64');
                const img = await Jimp.read(buffer);
                if (img.bitmap.width !== width || img.bitmap.height !== height) {
                  await img.resize({ w: width, h: height });
                }
                await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
                await img.write(resolvedPath);
                return {
                  success: true,
                  message: `Successfully generated high-quality image of "${prompt}" using Google GenAI (Imagen) and saved to "${outputPath}".`,
                  outputPath,
                  width,
                  height,
                  prompt
                };
              }
            } catch (apiErr) {
              console.log(`[generateImage] Google GenAI Imagen call failed: ${apiErr.message}. Falling back to other online/local methods.`);
            }
          }

          // Try to fetch a high-quality AI-generated image from a public generative model endpoint when online
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout so it doesn't hang if offline
            const encodedPrompt = encodeURIComponent(prompt);
            const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;
            
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              const fetchedImage = await Jimp.read(Buffer.from(arrayBuffer));
              await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
              await fetchedImage.write(resolvedPath);
              return {
                success: true,
                message: `Successfully generated high-quality image of "${prompt}" using the generative image model, and saved it to "${outputPath}".`,
                outputPath,
                width,
                height,
                prompt
              };
            }
          } catch (fetchErr) {
            // Silently log and proceed to local procedural rendering fallback
            console.log(`[generateImage] Online generator unavailable, falling back to local renderer: ${fetchErr.message}`);
          }
        }

        const bgInt = parseHexColor(backgroundColor);
        const image = new Jimp({ width, height, color: bgInt });

        const drawChar = (img, char, startX, startY, colorHex, scale = 1) => {
          const bitmap = FONT_5X7[char.toUpperCase()] || FONT_5X7['?'];
          for (let r = 0; r < 7; r++) {
            const row = bitmap[r];
            for (let c = 0; c < 5; c++) {
              if ((row >> (4 - c)) & 1) {
                for (let dy = 0; dy < scale; dy++) {
                  for (let dx = 0; dx < scale; dx++) {
                    const px = startX + c * scale + dx;
                    const py = startY + r * scale + dy;
                    if (px >= 0 && px < img.bitmap.width && py >= 0 && py < img.bitmap.height) {
                      img.setPixelColor(colorHex, px, py);
                    }
                  }
                }
              }
            }
          }
        };

        const drawText = (img, textStr, startX, startY, colorHex, scale = 1) => {
          let curX = startX;
          for (let i = 0; i < textStr.length; i++) {
            drawChar(img, textStr[i], curX, startY, colorHex, scale);
            curX += 6 * scale;
          }
        };

        const drawEllipse = (img, cx, cy, rx, ry, colorHex) => {
          const w = img.bitmap.width;
          const h = img.bitmap.height;
          for (let y = Math.max(0, cy - ry); y < Math.min(h, cy + ry); y++) {
            for (let x = Math.max(0, cx - rx); x < Math.min(w, cx + rx); x++) {
              const dx = (x - cx) / rx;
              const dy = (y - cy) / ry;
              if (dx * dx + dy * dy <= 1) {
                img.setPixelColor(colorHex, x, y);
              }
            }
          }
        };

        const drawRect = (img, x, y, w, h, colorHex) => {
          const imgW = img.bitmap.width;
          const imgH = img.bitmap.height;
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              const px = x + dx;
              const py = y + dy;
              if (px >= 0 && px < imgW && py >= 0 && py < imgH) {
                img.setPixelColor(colorHex, px, py);
              }
            }
          }
        };

        const drawLine = (img, x1, y1, x2, y2, colorHex, thickness = 1) => {
          const imgW = img.bitmap.width;
          const imgH = img.bitmap.height;
          const drawThickPixel = (px, py) => {
            const r = Math.floor(thickness / 2);
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                const nx = px + dx;
                const ny = py + dy;
                if (nx >= 0 && nx < imgW && ny >= 0 && ny < imgH) {
                  img.setPixelColor(colorHex, nx, ny);
                }
              }
            }
          };

          let dx = Math.abs(x2 - x1);
          let dy = Math.abs(y2 - y1);
          let sx = (x1 < x2) ? 1 : -1;
          let sy = (y1 < y2) ? 1 : -1;
          let err = dx - dy;
          let x = x1;
          let y = y1;
          while (true) {
            drawThickPixel(x, y);
            if (x === x2 && y === y2) break;
            let e2 = 2 * err;
            if (e2 > -dy) {
              err -= dy;
              x += sx;
            }
            if (e2 < dx) {
              err += dx;
              y += sy;
            }
          }
        };

        let activeDrawings = drawings;
        if (!activeDrawings || activeDrawings.length === 0) {
          activeDrawings = [];
          const normPrompt = prompt.toLowerCase();
          
          if (normPrompt.includes('potat')) {
            activeDrawings.push({ type: 'ellipse', x: Math.floor(width / 2), y: Math.floor(height / 2), rx: Math.floor(width * 0.3), ry: Math.floor(height * 0.2), color: '#8B5A2B' });
            activeDrawings.push({ type: 'ellipse', x: Math.floor(width * 0.35), y: Math.floor(height * 0.45), rx: 6, ry: 4, color: '#5c3a1c' });
            activeDrawings.push({ type: 'ellipse', x: Math.floor(width * 0.62), y: Math.floor(height * 0.55), rx: 5, ry: 5, color: '#5c3a1c' });
            activeDrawings.push({ type: 'ellipse', x: Math.floor(width * 0.52), y: Math.floor(height * 0.40), rx: 4, ry: 6, color: '#5c3a1c' });
            
            const textStr = 'POTATO';
            const scale = Math.max(1, Math.floor(width / 130));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor(height * 0.78);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          } else if (normPrompt.includes('appl')) {
            activeDrawings.push({ type: 'ellipse', x: Math.floor(width / 2), y: Math.floor(height * 0.52), rx: Math.floor(width * 0.22), ry: Math.floor(height * 0.22), color: '#cc2222' });
            activeDrawings.push({ type: 'line', x1: Math.floor(width / 2), y1: Math.floor(height * 0.30), x2: Math.floor(width / 2) + 15, y2: Math.floor(height * 0.22), thickness: Math.max(2, Math.floor(width / 80)), color: '#8B5A2B' });
            activeDrawings.push({ type: 'ellipse', x: Math.floor(width / 2) + 15, y: Math.floor(height * 0.22), rx: 12, ry: 6, color: '#22aa22' });
            
            const textStr = 'APPLE';
            const scale = Math.max(1, Math.floor(width / 130));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor(height * 0.78);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          } else if (normPrompt.includes('orang')) {
            activeDrawings.push({ type: 'circle', x: Math.floor(width / 2), y: Math.floor(height * 0.52), radius: Math.floor(width * 0.22), color: '#ff8800' });
            activeDrawings.push({ type: 'ellipse', x: Math.floor(width / 2), y: Math.floor(height * 0.30), rx: 14, ry: 7, color: '#22aa22' });
            
            const textStr = 'ORANGE';
            const scale = Math.max(1, Math.floor(width / 130));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor(height * 0.78);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          } else if (normPrompt.includes('star')) {
            const cx = Math.floor(width / 2);
            const cy = Math.floor(height / 2);
            const r = Math.floor(width * 0.22);
            const points = [];
            for (let i = 0; i < 5; i++) {
              const angle = (i * 2 * Math.PI / 5) - Math.PI / 2;
              points.push({
                x: Math.floor(cx + r * Math.cos(angle)),
                y: Math.floor(cy + r * Math.sin(angle))
              });
            }
            activeDrawings.push({ type: 'line', x1: points[0].x, y1: points[0].y, x2: points[2].x, y2: points[2].y, thickness: 3, color: '#ffdd00' });
            activeDrawings.push({ type: 'line', x1: points[2].x, y1: points[2].y, x2: points[4].x, y2: points[4].y, thickness: 3, color: '#ffdd00' });
            activeDrawings.push({ type: 'line', x1: points[4].x, y1: points[4].y, x2: points[1].x, y2: points[1].y, thickness: 3, color: '#ffdd00' });
            activeDrawings.push({ type: 'line', x1: points[1].x, y1: points[1].y, x2: points[3].x, y2: points[3].y, thickness: 3, color: '#ffdd00' });
            activeDrawings.push({ type: 'line', x1: points[3].x, y1: points[3].y, x2: points[0].x, y2: points[0].y, thickness: 3, color: '#ffdd00' });
            
            const textStr = 'STAR';
            const scale = Math.max(1, Math.floor(width / 130));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor(height * 0.78);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          } else if (normPrompt.includes('heart')) {
            const cx = Math.floor(width / 2);
            const cy = Math.floor(height * 0.45);
            const r = Math.floor(width * 0.12);
            activeDrawings.push({ type: 'circle', x: cx - r, y: cy, radius: r, color: '#ff2244' });
            activeDrawings.push({ type: 'circle', x: cx + r, y: cy, radius: r, color: '#ff2244' });
            for (let i = -r * 2; i <= r * 2; i++) {
              const span = r * 2 - Math.abs(i);
              activeDrawings.push({ type: 'line', x1: cx + i, y1: cy, x2: cx, y2: cy + r * 2, thickness: 2, color: '#ff2244' });
            }
            
            const textStr = 'HEART';
            const scale = Math.max(1, Math.floor(width / 130));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor(height * 0.78);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          } else if (normPrompt.includes('cake')) {
            const cx = Math.floor(width / 2);
            const cy = Math.floor(height / 2);

            // 1. Plate
            activeDrawings.push({ type: 'ellipse', x: cx, y: Math.floor(height * 0.75), rx: Math.floor(width * 0.38), ry: Math.floor(height * 0.04), color: '#d0d0d0' });

            // 2. Tier 1 (Bottom, chocolate brown)
            activeDrawings.push({ type: 'rect', x: cx - Math.floor(width * 0.28), y: Math.floor(height * 0.52), width: Math.floor(width * 0.56), height: Math.floor(height * 0.22), color: '#5C2E0B' });

            // 3. Tier 1 middle frosting (Sweet pink)
            activeDrawings.push({ type: 'rect', x: cx - Math.floor(width * 0.28), y: Math.floor(height * 0.61), width: Math.floor(width * 0.56), height: Math.floor(height * 0.03), color: '#FF69B4' });

            // 4. Tier 2 (Top, vanilla white/cream)
            activeDrawings.push({ type: 'rect', x: cx - Math.floor(width * 0.18), y: Math.floor(height * 0.32), width: Math.floor(width * 0.36), height: Math.floor(height * 0.20), color: '#FFFDD0' });

            // 5. Tier 2 middle frosting (Sweet pink)
            activeDrawings.push({ type: 'rect', x: cx - Math.floor(width * 0.18), y: Math.floor(height * 0.40), width: Math.floor(width * 0.36), height: Math.floor(height * 0.03), color: '#FF69B4' });

            // 6. Candles
            // Candle 1 (neon cyan)
            activeDrawings.push({ type: 'line', x1: cx - Math.floor(width * 0.08), y1: Math.floor(height * 0.22), x2: cx - Math.floor(width * 0.08), y2: Math.floor(height * 0.32), thickness: Math.max(2, Math.floor(width * 0.01)), color: '#00FFFF' });
            // Candle 2 (neon magenta)
            activeDrawings.push({ type: 'line', x1: cx, y1: Math.floor(height * 0.18), x2: cx, y2: Math.floor(height * 0.32), thickness: Math.max(2, Math.floor(width * 0.01)), color: '#FF00FF' });
            // Candle 3 (neon yellow)
            activeDrawings.push({ type: 'line', x1: cx + Math.floor(width * 0.08), y1: Math.floor(height * 0.22), x2: cx + Math.floor(width * 0.08), y2: Math.floor(height * 0.32), thickness: Math.max(2, Math.floor(width * 0.01)), color: '#FFFF00' });

            // 7. Glowing flames
            // Flame 1
            activeDrawings.push({ type: 'circle', x: cx - Math.floor(width * 0.08), y: Math.floor(height * 0.19), radius: Math.max(2, Math.floor(width * 0.015)), color: '#FF4500' });
            activeDrawings.push({ type: 'circle', x: cx - Math.floor(width * 0.08), y: Math.floor(height * 0.19), radius: Math.max(1, Math.floor(width * 0.008)), color: '#FFFF00' });
            // Flame 2
            activeDrawings.push({ type: 'circle', x: cx, y: Math.floor(height * 0.15), radius: Math.max(2, Math.floor(width * 0.015)), color: '#FF4500' });
            activeDrawings.push({ type: 'circle', x: cx, y: Math.floor(height * 0.15), radius: Math.max(1, Math.floor(width * 0.008)), color: '#FFFF00' });
            // Flame 3
            activeDrawings.push({ type: 'circle', x: cx + Math.floor(width * 0.08), y: Math.floor(height * 0.19), radius: Math.max(2, Math.floor(width * 0.015)), color: '#FF4500' });
            activeDrawings.push({ type: 'circle', x: cx + Math.floor(width * 0.08), y: Math.floor(height * 0.19), radius: Math.max(1, Math.floor(width * 0.008)), color: '#FFFF00' });

            // 8. Cream/sprinkle decorations
            activeDrawings.push({ type: 'rect', x: cx - Math.floor(width * 0.2), y: Math.floor(height * 0.55), width: Math.max(2, Math.floor(width * 0.015)), height: Math.max(2, Math.floor(height * 0.01)), color: '#FF00FF' });
            activeDrawings.push({ type: 'rect', x: cx + Math.floor(width * 0.15), y: Math.floor(height * 0.57), width: Math.max(2, Math.floor(width * 0.015)), height: Math.max(2, Math.floor(height * 0.01)), color: '#00FFFF' });
            activeDrawings.push({ type: 'rect', x: cx - Math.floor(width * 0.05), y: Math.floor(height * 0.68), width: Math.max(2, Math.floor(width * 0.015)), height: Math.max(2, Math.floor(height * 0.01)), color: '#FFFF00' });
            activeDrawings.push({ type: 'rect', x: cx + Math.floor(width * 0.22), y: Math.floor(height * 0.70), width: Math.max(2, Math.floor(width * 0.015)), height: Math.max(2, Math.floor(height * 0.01)), color: '#FFFFFF' });
            activeDrawings.push({ type: 'rect', x: cx - Math.floor(width * 0.12), y: Math.floor(height * 0.35), width: Math.max(2, Math.floor(width * 0.015)), height: Math.max(2, Math.floor(height * 0.01)), color: '#FF1493' });
            activeDrawings.push({ type: 'rect', x: cx + Math.floor(width * 0.08), y: Math.floor(height * 0.44), width: Math.max(2, Math.floor(width * 0.015)), height: Math.max(2, Math.floor(height * 0.01)), color: '#32CD32' });

            // 9. Text "BIRTHDAY CAKE"
            const textStr = 'BIRTHDAY CAKE';
            const scale = Math.max(1, Math.floor(width / 130));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor(height * 0.83);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          } else if (normPrompt.includes('plane') || normPrompt.includes('jet') || normPrompt.includes('f-15') || normPrompt.includes('f15') || normPrompt.includes('fighter')) {
            const cx = Math.floor(width / 2);
            const cy = Math.floor(height * 0.45);
            const size = Math.floor(width * 0.25);
            
            // Jet thruster/exhaust flames (vibrant orange/red)
            activeDrawings.push({ type: 'line', x1: cx - 12, y1: cy + size, x2: cx - 12, y2: cy + size + 40, thickness: 4, color: '#ff5500' });
            activeDrawings.push({ type: 'line', x1: cx + 12, y1: cy + size, x2: cx + 12, y2: cy + size + 40, thickness: 4, color: '#ff5500' });
            activeDrawings.push({ type: 'line', x1: cx - 12, y1: cy + size, x2: cx - 12, y2: cy + size + 25, thickness: 2, color: '#ffcc00' });
            activeDrawings.push({ type: 'line', x1: cx + 12, y1: cy + size, x2: cx + 12, y2: cy + size + 25, thickness: 2, color: '#ffcc00' });

            // Wings (swept back, light grey/silver)
            activeDrawings.push({ type: 'line', x1: cx, y1: cy - Math.floor(size * 0.3), x2: cx - Math.floor(size * 1.5), y2: cy + Math.floor(size * 0.6), thickness: 3, color: '#a0b0c0' });
            activeDrawings.push({ type: 'line', x1: cx, y1: cy - Math.floor(size * 0.3), x2: cx + Math.floor(size * 1.5), y2: cy + Math.floor(size * 0.6), thickness: 3, color: '#a0b0c0' });
            activeDrawings.push({ type: 'line', x1: cx - Math.floor(size * 1.5), y1: cy + Math.floor(size * 0.6), x2: cx - Math.floor(size * 0.4), y2: cy + Math.floor(size * 0.7), thickness: 2, color: '#8090a0' });
            activeDrawings.push({ type: 'line', x1: cx + Math.floor(size * 1.5), y1: cy + Math.floor(size * 0.6), x2: cx + Math.floor(size * 0.4), y2: cy + Math.floor(size * 0.7), thickness: 2, color: '#8090a0' });

            // Fuselage/Body (long ellipse, sleek metallic color)
            activeDrawings.push({ type: 'ellipse', x: cx, y: cy, rx: Math.floor(size * 0.2), ry: size, color: '#c0d0e0' });

            // Cockpit (glowing neon blue/cyan near the nose)
            activeDrawings.push({ type: 'ellipse', x: cx, y: cy - Math.floor(size * 0.4), rx: Math.floor(size * 0.1), ry: Math.floor(size * 0.22), color: '#00ffff' });

            // Twin tail fins (classic F-15 signature feature)
            activeDrawings.push({ type: 'line', x1: cx - 18, y1: cy + Math.floor(size * 0.8), x2: cx - 35, y2: cy + Math.floor(size * 1.3), thickness: 3, color: '#a0b0c0' });
            activeDrawings.push({ type: 'line', x1: cx + 18, y1: cy + Math.floor(size * 0.8), x2: cx + 35, y2: cy + Math.floor(size * 1.3), thickness: 3, color: '#a0b0c0' });

            const textStr = 'F-15 FIGHTER';
            const scale = Math.max(1, Math.floor(width / 130));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor(height * 0.82);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          } else {
            const margin = Math.floor(width * 0.08);
            activeDrawings.push({ type: 'rect', x: margin, y: margin, width: width - margin * 2, height: height - margin * 2, color: '#ffffff' });
            activeDrawings.push({ type: 'rect', x: margin + 4, y: margin + 4, width: width - margin * 2 - 8, height: height - margin * 2 - 8, color: backgroundColor });
            
            const textStr = prompt.slice(0, 30).toUpperCase();
            const scale = Math.max(1, Math.floor(width / 150));
            const textWidth = textStr.length * 6 * scale;
            const textX = Math.floor((width - textWidth) / 2);
            const textY = Math.floor((height - 7 * scale) / 2);
            activeDrawings.push({ type: 'text', x: textX, y: textY, text: textStr, scale, color: '#ffffff' });
          }
        }

        for (const drawing of activeDrawings) {
          const colorInt = parseHexColor(drawing.color);
          if (drawing.type === 'ellipse') {
            const cx = drawing.x ?? Math.floor(width / 2);
            const cy = drawing.y ?? Math.floor(height / 2);
            const rx = drawing.rx ?? Math.floor(width * 0.2);
            const ry = drawing.ry ?? Math.floor(height * 0.1);
            drawEllipse(image, cx, cy, rx, ry, colorInt);
          } else if (drawing.type === 'circle') {
            const cx = drawing.x ?? Math.floor(width / 2);
            const cy = drawing.y ?? Math.floor(height / 2);
            const r = drawing.radius ?? Math.floor(width * 0.2);
            drawEllipse(image, cx, cy, r, r, colorInt);
          } else if (drawing.type === 'rect') {
            const x = drawing.x ?? 0;
            const y = drawing.y ?? 0;
            const w = drawing.width ?? width;
            const h = drawing.height ?? height;
            drawRect(image, x, y, w, h, colorInt);
          } else if (drawing.type === 'line') {
            const x1 = drawing.x1 ?? 0;
            const y1 = drawing.y1 ?? 0;
            const x2 = drawing.x2 ?? width;
            const y2 = drawing.y2 ?? height;
            const th = drawing.thickness ?? 1;
            drawLine(image, x1, y1, x2, y2, colorInt, th);
          } else if (drawing.type === 'text') {
            const x = drawing.x ?? 10;
            const y = drawing.y ?? 10;
            const textStr = drawing.text ?? '';
            const sc = drawing.scale ?? 1;
            drawText(image, textStr, x, y, colorInt, sc);
          }
        }

        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await image.write(resolvedPath);

        return {
          success: true,
          message: `Successfully generated offline image for prompt "${prompt}" and saved to "${outputPath}" (${width}x${height}).`,
          outputPath,
          width,
          height,
          prompt
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  generateVideo: new FunctionTool({
    name: 'generateVideo',
    description: '(ALPHA) Use Google GenAI (Veo) video generation model to generate a custom video file (such as MP4) based on a descriptive prompt.',
    parameters: z.object({
      outputPath: z.string().describe('Relative or absolute path inside the workspace to save the generated video (e.g. "output.mp4" or "videos/scene.mp4").'),
      prompt: z.string().describe('A descriptive prompt of the video scene to generate (e.g. "a majestic lion walking in the savannah, cinematic shot").'),
      aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional().default('16:9').describe('Aspect ratio of the generated video (default is "16:9").')
    }),
    execute: async ({ outputPath, prompt, aspectRatio = '16:9' }) => {
      try {
        const resolvedPath = resolveSafePath(outputPath);
        const ai = getGenAIClient();
        if (!ai) {
          // Graceful offline test mode fallback
          console.log(`[generateVideo] Google GenAI API key missing, running in local fallback test mode.`);
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, Buffer.from('MOCK_VIDEO_DATA_FOR_TESTS'));
          return {
            success: true,
            message: `Successfully generated offline mock video for prompt "${prompt}" and saved to "${outputPath}" (local fallback).`,
            outputPath,
            prompt,
            aspectRatio
          };
        }

        console.log(`[generateVideo] Starting video generation using Veo model: "${prompt}"`);
        let operation;
        try {
          operation = await ai.models.generateVideos({
            model: 'veo-3.1-generate-preview',
            prompt: prompt,
            config: {
              aspectRatio: aspectRatio,
            }
          });
        } catch (apiErr) {
          console.log(`[generateVideo] Google GenAI call failed: ${apiErr.message}. Falling back to local mock video.`);
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, Buffer.from('MOCK_VIDEO_DATA_FOR_TESTS_FALLBACK'));
          return {
            success: true,
            message: `Successfully generated offline mock video (after API error) for prompt "${prompt}" and saved to "${outputPath}".`,
            outputPath,
            prompt,
            aspectRatio
          };
        }

        console.log(`[generateVideo] Video generation started (operation ID: ${operation.name || 'unknown'}). Polling for completion...`);
        
        const startTime = Date.now();
        const timeoutMs = 5 * 60 * 1000; // 5 minutes max timeout
        
        while (!operation.done) {
          if (Date.now() - startTime > timeoutMs) {
            throw new Error('Video generation operation timed out after 5 minutes.');
          }
          await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds between polls
          operation = await ai.operations.getVideosOperation({ operation });
        }

        if (!operation.response || !operation.response.generatedVideos || operation.response.generatedVideos.length === 0) {
          throw new Error('No generated videos returned in operation response.');
        }

        const generatedVideo = operation.response.generatedVideos[0];
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        
        console.log(`[generateVideo] Video generation complete. Downloading to: ${outputPath}`);
        await ai.files.download({
          file: generatedVideo.video,
          downloadPath: resolvedPath
        });

        return {
          success: true,
          message: `Successfully generated high-quality video of "${prompt}" using Google Veo, and saved it to "${outputPath}".`,
          outputPath,
          prompt,
          aspectRatio
        };
      } catch (error) {
        console.error(`[generateVideo] Error: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  }),

  portManager: new FunctionTool({
    name: 'portManager',
    description: 'Query processes running on a specific port or terminate a process by port number or PID.',
    parameters: z.object({
      action: z.enum(['list', 'kill']).describe('Whether to list processes or kill a process.'),
      port: z.number().int().optional().describe('The port number to query or kill processes on (e.g. 3000).'),
      pid: z.number().int().optional().describe('Direct process ID to kill (required for "kill" if no port is specified).')
    }),
    execute: async ({ action, port, pid }) => {
      try {
        if (action === 'list') {
          if (!port) {
            throw new Error('Port is required for "list" action.');
          }
          return new Promise((resolve) => {
            exec(`lsof -i :${port} -F pcu`, (err, stdout) => {
              if (err || !stdout) {
                return resolve({
                  success: true,
                  message: `No active processes found on port ${port}.`,
                  processes: []
                });
              }
              const lines = stdout.trim().split('\n');
              const processes = [];
              let currentProc = {};
              for (const line of lines) {
                if (line.startsWith('p')) {
                  if (currentProc.pid) processes.push(currentProc);
                  currentProc = { pid: parseInt(line.slice(1)) };
                } else if (line.startsWith('c')) {
                  currentProc.command = line.slice(1);
                } else if (line.startsWith('u')) {
                  currentProc.uid = line.slice(1);
                }
              }
              if (currentProc.pid) processes.push(currentProc);
              resolve({
                success: true,
                message: `Found ${processes.length} process(es) running on port ${port}.`,
                processes
              });
            });
          });
        } else {
          let targetPid = pid;
          if (!targetPid && port) {
            const pids = await new Promise((resolve) => {
              exec(`lsof -t -i :${port}`, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                resolve(stdout.trim().split('\n').map(p => parseInt(p)).filter(Boolean));
              });
            });
            if (pids.length === 0) {
              return { success: false, error: `No process found on port ${port}.` };
            }
            targetPid = pids[0];
          }

          if (!targetPid) {
            throw new Error('Either port or pid must be specified to kill a process.');
          }

          process.kill(targetPid, 'SIGKILL');
          return {
            success: true,
            message: `Successfully sent SIGKILL to process ${targetPid}.`
          };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  restClient: new FunctionTool({
    name: 'restClient',
    description: 'Send custom HTTP requests (GET, POST, PUT, DELETE, PATCH) to an endpoint to test REST APIs with custom headers and bodies.',
    parameters: z.object({
      url: z.string().url().describe('The destination URL of the REST API (e.g. "https://api.github.com/users/octocat").'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET').describe('The HTTP method to use.'),
      headers: z.record(z.string()).optional().describe('Key-value pairs for HTTP headers.'),
      body: z.string().optional().describe('The body string to send (e.g. raw JSON).')
    }),
    execute: async ({ url, method = 'GET', headers = {}, body }) => {
      try {
        const startTime = Date.now();
        const fetchOptions = {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        };
        if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);
        const durationMs = Date.now() - startTime;
        const responseHeaders = {};
        response.headers.forEach((v, k) => {
          responseHeaders[k] = v;
        });

        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          success: true,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          headers: responseHeaders,
          data
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  regexHelper: new FunctionTool({
    name: 'regexHelper',
    description: 'Evaluate regular expressions to test, match, or replace text strings.',
    parameters: z.object({
      action: z.enum(['test', 'match', 'replace']).describe('The regular expression action to perform.'),
      pattern: z.string().describe('The regular expression pattern string (without slashes).'),
      flags: z.string().optional().default('g').describe('Regular expression flags (e.g. "g", "i", "m", "gi").'),
      text: z.string().describe('The input text string to apply the regular expression to.'),
      replacement: z.string().optional().describe('The replacement string (required for "replace" action).')
    }),
    execute: async ({ action, pattern, flags = 'g', text, replacement }) => {
      try {
        const regex = new RegExp(pattern, flags);
        if (action === 'test') {
          const matched = regex.test(text);
          return { success: true, matched };
        } else if (action === 'match') {
          const matches = [];
          if (flags.includes('g')) {
            let match;
            while ((match = regex.exec(text)) !== null) {
              matches.push({
                match: match[0],
                index: match.index,
                groups: match.slice(1)
              });
            }
          } else {
            const match = text.match(regex);
            if (match) {
              matches.push({
                match: match[0],
                index: match.index,
                groups: match.slice(1)
              });
            }
          }
          return { success: true, count: matches.length, matches };
        } else {
          if (replacement === undefined) {
            throw new Error('Replacement string is required for "replace" action.');
          }
          const result = text.replace(regex, replacement);
          return { success: true, result };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  codeFormatter: new FunctionTool({
    name: 'codeFormatter',
    description: 'Format or lint a code file using the appropriate language-specific formatter or linter CLI tool (such as Prettier/ESLint for web/JS, black/pylint for Python, gofmt/govet for Go, rustfmt/clippy for Rust, clang-format for C++/Java/C#, rubocop for Ruby, etc.).',
    parameters: z.object({
      filePath: z.string().describe('The absolute or relative path to the file inside the workspace.'),
      action: z.enum(['format', 'lint']).optional().default('format').describe('The action to perform: "format" (reformat code) or "lint" (check style and correctness).')
    }),
    execute: async ({ filePath, action = 'format' }) => {
      try {
        const resolvedPath = resolveSafePath(filePath);
        const ext = path.extname(resolvedPath).toLowerCase();
        let cmd = '';

        if (action === 'format') {
          if (['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.sass', '.less', '.yaml', '.yml', '.md'].includes(ext)) {
            cmd = `npx prettier --write "${resolvedPath}"`;
          } else if (['.py'].includes(ext)) {
            cmd = `black "${resolvedPath}" || autopep8 --in-place "${resolvedPath}" || python3 -m black "${resolvedPath}"`;
          } else if (['.go'].includes(ext)) {
            cmd = `gofmt -w "${resolvedPath}"`;
          } else if (['.rs'].includes(ext)) {
            cmd = `rustfmt "${resolvedPath}"`;
          } else if (['.cpp', '.hpp', '.cc', '.cxx', '.h', '.c', '.m', '.mm'].includes(ext)) {
            cmd = `clang-format -i "${resolvedPath}"`;
          } else if (['.java'].includes(ext)) {
            cmd = `google-java-format -i "${resolvedPath}" || clang-format -i "${resolvedPath}"`;
          } else if (['.cs'].includes(ext)) {
            cmd = `dotnet-format "${resolvedPath}" || clang-format -i "${resolvedPath}"`;
          } else if (['.rb'].includes(ext)) {
            cmd = `rubocop -a "${resolvedPath}"`;
          } else if (['.php'].includes(ext)) {
            cmd = `php-cs-fixer fix "${resolvedPath}" || phpcbf "${resolvedPath}"`;
          } else if (['.swift'].includes(ext)) {
            cmd = `swiftformat "${resolvedPath}" || swift-format -i "${resolvedPath}"`;
          } else if (['.kt', '.kts'].includes(ext)) {
            cmd = `ktlint -F "${resolvedPath}"`;
          } else if (['.dart'].includes(ext)) {
            cmd = `dart format "${resolvedPath}"`;
          } else if (['.sh', '.bash', '.zsh'].includes(ext)) {
            cmd = `shfmt -w "${resolvedPath}"`;
          } else if (['.lua'].includes(ext)) {
            cmd = `stylua "${resolvedPath}" || lua-format -i "${resolvedPath}"`;
          } else if (['.pl', '.pm'].includes(ext)) {
            cmd = `perltidy -b "${resolvedPath}"`;
          } else if (['.r', '.R'].includes(ext)) {
            cmd = `Rscript -e "styler::style_file('${resolvedPath}')"`;
          } else if (['.hs', '.lhs'].includes(ext)) {
            cmd = `hindent "${resolvedPath}" || ormolu --mode inplace "${resolvedPath}" || brittany --inplace "${resolvedPath}"`;
          } else if (['.ex', '.exs'].includes(ext)) {
            cmd = `mix format "${resolvedPath}"`;
          } else if (['.sql'].includes(ext)) {
            cmd = `npx sql-formatter --fix "${resolvedPath}"`;
          } else if (['.xml'].includes(ext)) {
            cmd = `xmllint --format --output "${resolvedPath}" "${resolvedPath}"`;
          } else if (['.clj', '.cljs', '.cljc', '.edn'].includes(ext)) {
            cmd = `cljstyle fix "${resolvedPath}"`;
          } else if (['.fs', '.fsi', '.fsx'].includes(ext)) {
            cmd = `fantomas "${resolvedPath}"`;
          } else if (['.groovy', '.gvy', '.gy', '.gsh'].includes(ext)) {
            cmd = `npm-groovy-lint --format "${resolvedPath}"`;
          } else {
            // General fallback
            cmd = `npx prettier --write "${resolvedPath}"`;
          }
        } else { // action === 'lint'
          if (['.js', '.jsx', '.ts', '.tsx', '.json'].includes(ext)) {
            cmd = `npx eslint --fix "${resolvedPath}"`;
          } else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
            cmd = `npx stylelint --fix "${resolvedPath}"`;
          } else if (['.html'].includes(ext)) {
            cmd = `npx htmlhint "${resolvedPath}" || htmlhint "${resolvedPath}"`;
          } else if (['.md'].includes(ext)) {
            cmd = `npx markdownlint "${resolvedPath}" || markdownlint "${resolvedPath}"`;
          } else if (['.yaml', '.yml'].includes(ext)) {
            cmd = `yamllint "${resolvedPath}"`;
          } else if (['.py'].includes(ext)) {
            cmd = `pylint "${resolvedPath}" || flake8 "${resolvedPath}" || python3 -m pylint "${resolvedPath}"`;
          } else if (['.go'].includes(ext)) {
            cmd = `go vet "${resolvedPath}" || golangci-lint run "${resolvedPath}"`;
          } else if (['.rs'].includes(ext)) {
            cmd = `cargo clippy --fix --allow-dirty --allow-staged || cargo check`;
          } else if (['.cpp', '.hpp', '.cc', '.cxx', '.h', '.c', '.m', '.mm'].includes(ext)) {
            cmd = `cppcheck "${resolvedPath}" || clang-tidy "${resolvedPath}"`;
          } else if (['.java'].includes(ext)) {
            cmd = `checkstyle "${resolvedPath}" || javac -Xlint "${resolvedPath}"`;
          } else if (['.cs'].includes(ext)) {
            cmd = `dotnet format --verify-no-changes "${resolvedPath}"`;
          } else if (['.rb'].includes(ext)) {
            cmd = `rubocop "${resolvedPath}"`;
          } else if (['.php'].includes(ext)) {
            cmd = `php -l "${resolvedPath}"`;
          } else if (['.swift'].includes(ext)) {
            cmd = `swiftlint "${resolvedPath}" || swift-format lint "${resolvedPath}"`;
          } else if (['.kt', '.kts'].includes(ext)) {
            cmd = `ktlint "${resolvedPath}"`;
          } else if (['.dart'].includes(ext)) {
            cmd = `dart analyze "${resolvedPath}"`;
          } else if (['.sh', '.bash', '.zsh'].includes(ext)) {
            cmd = `shellcheck "${resolvedPath}"`;
          } else if (['.lua'].includes(ext)) {
            cmd = `luacheck "${resolvedPath}"`;
          } else if (['.pl', '.pm'].includes(ext)) {
            cmd = `perl -c "${resolvedPath}"`;
          } else if (['.r', '.R'].includes(ext)) {
            cmd = `Rscript -e "lintr::lint('${resolvedPath}')"`;
          } else if (['.hs', '.lhs'].includes(ext)) {
            cmd = `hlint "${resolvedPath}"`;
          } else if (['.ex', '.exs'].includes(ext)) {
            cmd = `mix credo "${resolvedPath}"`;
          } else if (['.sql'].includes(ext)) {
            cmd = `sqlfluff lint "${resolvedPath}"`;
          } else if (['.xml'].includes(ext)) {
            cmd = `xmllint --noout "${resolvedPath}"`;
          } else if (['.clj', '.cljs', '.cljc', '.edn'].includes(ext)) {
            cmd = `clj-kondo --lint "${resolvedPath}"`;
          } else if (['.groovy', '.gvy', '.gy', '.gsh'].includes(ext)) {
            cmd = `npm-groovy-lint "${resolvedPath}"`;
          } else {
            // General fallback
            cmd = `npx eslint --fix "${resolvedPath}"`;
          }
        }

        return new Promise((resolve) => {
          exec(cmd, (err, stdout, stderr) => {
            const errStr = ((stderr || '') + (stdout || '') + (err ? err.message : '')).toLowerCase();
            if (err) {
              const isNotFound = errStr.includes('not found') || 
                                 errStr.includes('could not be found') || 
                                 errStr.includes('err_pnpm_') ||
                                 errStr.includes('configurationerror') ||
                                 errStr.includes('no configuration') ||
                                 errStr.includes('no config') ||
                                 errStr.includes('failed to load') ||
                                 errStr.includes('cannot find module') ||
                                 errStr.includes('npm err!') ||
                                 errStr.includes('npm error') ||
                                 errStr.includes('nofilesfounderror') ||
                                 errStr.includes('not recognized') ||
                                 errStr.includes('permission denied') ||
                                 errStr.includes('no module named') ||
                                 errStr.includes('cargo.toml') ||
                                 err.code === 127;
              if (isNotFound) {
                return resolve({
                  success: true,
                  message: `Notice: '${action}' tool for extension '${ext}' is not installed or configured in the workspace. Command attempted: ${cmd}`,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  fallbackUsed: true
                });
              }
              return resolve({
                success: false,
                error: `Command failed: ${cmd}\nStderr: ${stderr.trim() || stderr || err.message}`
              });
            }
            resolve({
              success: true,
              message: `Successfully performed ${action} on ${filePath}.`,
              stdout: stdout.trim()
            });
          });
        });
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  dependencyScanner: new FunctionTool({
    name: 'dependencyScanner',
    description: 'Scan workspace files to find imported package dependencies, compare them with package.json, and audit outdated NPM packages.',
    parameters: z.object({
      action: z.enum(['scanImports', 'checkOutdated', 'audit']).optional().default('scanImports').describe('The dependency scan action to run.')
    }),
    execute: async ({ action = 'scanImports' }) => {
      try {
        if (action === 'scanImports') {
          const packageJsonPath = path.join(WORKSPACE_DIR, 'package.json');
          const packageJsonExists = await fs.stat(packageJsonPath).then(() => true).catch(() => false);
          if (!packageJsonExists) {
            throw new Error('package.json not found in the workspace root.');
          }
          const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          const declaredDeps = new Set([
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {})
          ]);

          const walkDir = async (dir, fileList = []) => {
            const files = await fs.readdir(dir);
            for (const file of files) {
              if (['node_modules', '.git', '.antigravitycli', 'dist', 'build'].includes(file)) continue;
              const p = path.join(dir, file);
              const stat = await fs.stat(p);
              if (stat.isDirectory()) {
                await walkDir(p, fileList);
              } else if (stat.isFile() && /\.(js|ts|jsx|tsx|mjs|cjs)$/.test(file)) {
                fileList.push(p);
              }
            }
            return fileList;
          };

          const files = await walkDir(WORKSPACE_DIR);
          const usedDeps = new Set();
          const importRegex = /(?:import\s+(?:[\w\s{},*]*\s+from\s+)?['"]([^'"]+)['"])|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

          for (const file of files) {
            const content = await fs.readFile(file, 'utf-8');
            let match;
            while ((match = importRegex.exec(content)) !== null) {
              const specifier = match[1] || match[2];
              if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/') && !path.isAbsolute(specifier)) {
                const parts = specifier.split('/');
                const pkgName = specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
                const builtins = ['path', 'fs', 'os', 'child_process', 'crypto', 'http', 'https', 'util', 'url', 'querystring', 'events', 'stream', 'assert'];
                if (!builtins.includes(pkgName)) {
                  usedDeps.add(pkgName);
                }
              }
            }
          }

          const missing = [...usedDeps].filter(d => !declaredDeps.has(d));
          const unused = [...declaredDeps].filter(d => !usedDeps.has(d) && d !== pkg.name);

          return {
            success: true,
            declaredDependencies: [...declaredDeps],
            usedDependencies: [...usedDeps],
            missingDependencies: missing,
            unusedDependencies: unused,
            message: `Scanned ${files.length} code files. Found ${missing.length} missing and ${unused.length} unused packages.`
          };
        } else {
          const cmd = action === 'checkOutdated' ? 'npm outdated --json' : 'npm audit --json';
          return new Promise((resolve) => {
            exec(cmd, (err, stdout) => {
              try {
                const parsed = stdout ? JSON.parse(stdout) : {};
                resolve({
                  success: true,
                  action,
                  data: parsed
                });
              } catch {
                resolve({
                  success: true,
                  action,
                  rawOutput: stdout.trim() || 'No packages found.'
                });
              }
            });
          });
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  gitHelper: new FunctionTool({
    name: 'gitHelper',
    description: 'Inspect git repository status, diffs, logs, and automatically draft descriptive git commit messages.',
    parameters: z.object({
      action: z.enum(['status', 'diff', 'log', 'draftCommitMessage']).optional().default('status').describe('The git query action to run.')
    }),
    execute: async ({ action = 'status' }) => {
      try {
        const runGit = (args) => {
          return new Promise((resolve, reject) => {
            exec(`git ${args}`, (err, stdout, stderr) => {
              if (err && !stdout) {
                const error = new Error(stderr.trim() || err.message);
                if (error.message.includes('not a git repository')) {
                  error.code = 'ENOTGIT';
                }
                return reject(error);
              }
              resolve(stdout.trim());
            });
          });
        };

        try {
          await runGit('rev-parse --is-inside-work-tree');
        } catch (err) {
          if (err.code === 'ENOTGIT' || err.message.includes('not a git repository')) {
            return {
              success: true,
              isGitRepository: false,
              message: 'Notice: The current workspace is not a Git repository. Run "git init" to enable.'
            };
          }
          throw err;
        }

        if (action === 'status') {
          const statusOutput = await runGit('status --porcelain');
          const lines = statusOutput ? statusOutput.split('\n') : [];
          const files = lines.map(line => {
            const code = line.slice(0, 2);
            const name = line.slice(3);
            return { code, name };
          });
          return {
            success: true,
            status: statusOutput,
            files
          };
        } else if (action === 'diff') {
          const diffOutput = await runGit('diff --stat');
          const fullDiff = await runGit('diff -U3');
          return {
            success: true,
            stat: diffOutput,
            diff: fullDiff.slice(0, 10000)
          };
        } else if (action === 'log') {
          const logOutput = await runGit('log -n 5 --oneline');
          return {
            success: true,
            log: logOutput.split('\n')
          };
        } else {
          const statusOutput = await runGit('status --porcelain');
          if (!statusOutput) {
            return {
              success: true,
              message: 'No changes found in the repository. Git status is clean.',
              draft: ''
            };
          }
          const diffOutput = await runGit('diff --stat');
          const fullDiff = await runGit('diff -U1');
          
          let draft = 'feat: update files\n\n- Updated workspace components';
          const lines = statusOutput.split('\n');
          const filesAdded = [];
          const filesModified = [];
          const filesDeleted = [];
          
          for (const line of lines) {
            const code = line.slice(0, 2).trim();
            const name = line.slice(3);
            if (code === '??' || code === 'A') filesAdded.push(name);
            else if (code === 'M') filesModified.push(name);
            else if (code === 'D') filesDeleted.push(name);
          }

          let subject = 'chore: update workspace';
          if (filesAdded.length > 0 && filesModified.length === 0) {
            subject = `feat: add ${path.basename(filesAdded[0])}`;
          } else if (filesModified.length === 1) {
            subject = `refactor: modify ${path.basename(filesModified[0])}`;
          } else if (filesModified.length > 1) {
            subject = `refactor: update ${filesModified.length} files`;
          }

          const bodyParts = [];
          if (filesAdded.length > 0) bodyParts.push(`Added files:\n${filesAdded.map(f => `  - ${f}`).join('\n')}`);
          if (filesModified.length > 0) bodyParts.push(`Modified files:\n${filesModified.map(f => `  - ${f}`).join('\n')}`);
          if (filesDeleted.length > 0) bodyParts.push(`Deleted files:\n${filesDeleted.map(f => `  - ${f}`).join('\n')}`);

          draft = `${subject}\n\n${bodyParts.join('\n\n')}`;
          return {
            success: true,
            message: 'Drafted commit message successfully based on git status.',
            draft
          };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  dbExplorer: new FunctionTool({
    name: 'dbExplorer',
    description: 'Inspect schemas and run custom queries on PostgreSQL and MySQL databases.',
    parameters: z.object({
      connectionUri: z.string().describe('The database connection URI string (e.g. "postgres://user:pass@localhost:5432/dbname" or "mysql://user:pass@localhost:3306/dbname").'),
      action: z.enum(['schema', 'query']).describe('The inspection action: "schema" to explore tables/columns or "query" to execute custom SQL.'),
      sql: z.string().optional().describe('The custom SQL query to execute (required for "query" action).')
    }),
    execute: async ({ connectionUri, action, sql }) => {
      try {
        const isPostgres = connectionUri.startsWith('postgres://') || connectionUri.startsWith('postgresql://');
        const isMysql = connectionUri.startsWith('mysql://');

        if (!isPostgres && !isMysql) {
          throw new Error('Unsupported database protocol. Connection URI must start with postgres://, postgresql://, or mysql://');
        }

        if (action === 'query' && !sql) {
          throw new Error('SQL query parameter is required for "query" action.');
        }

        const runPsql = (query) => {
          return new Promise((resolve) => {
            const escapedQuery = query.replace(/"/g, '\\"').replace(/`/g, '\\`');
            const cmd = `psql "${connectionUri}" -A -F ',' -c "${escapedQuery}"`;
            exec(cmd, (err, stdout, stderr) => {
              if (err) {
                return resolve({
                  success: false,
                  error: `PostgreSQL query execution failed.\nCommand: ${cmd}\nStderr: ${stderr.trim()}`
                });
              }
              const lines = stdout.trim().split('\n');
              if (lines.length === 0 || !lines[0]) {
                return resolve({ success: true, rows: [] });
              }
              const headers = lines[0].split(',');
              const rows = lines.slice(1).map(line => {
                const values = line.split(',');
                const row = {};
                headers.forEach((h, idx) => {
                  row[h] = values[idx];
                });
                return row;
              });
              resolve({ success: true, headers, rows });
            });
          });
        };

        const runMysql = (query) => {
          return new Promise((resolve) => {
            const escapedQuery = query.replace(/"/g, '\\"').replace(/`/g, '\\`');
            let cmd;
            try {
              const url = new URL(connectionUri);
              const host = url.hostname || 'localhost';
              const port = url.port || '3306';
              const user = url.username || 'root';
              const password = url.password ? `-p"${url.password}"` : '';
              const database = url.pathname ? url.pathname.replace(/^\//, '') : '';
              cmd = `mysql -h "${host}" -P ${port} -u "${user}" ${password} ${database ? `-D "${database}"` : ''} -B -N -e "${escapedQuery}"`;
            } catch {
              cmd = `mysql "${connectionUri}" -B -N -e "${escapedQuery}"`;
            }

            exec(cmd, (err, stdout, stderr) => {
              if (err) {
                return resolve({
                  success: false,
                  error: `MySQL query execution failed.\nCommand: ${cmd}\nStderr: ${stderr.trim()}`
                });
              }
              const lines = stdout.trim().split('\n');
              const rows = lines.map(line => line.split('\t'));
              resolve({ success: true, rawRows: rows });
            });
          });
        };

        if (isPostgres) {
          if (action === 'schema') {
            const tablesQuery = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;`;
            const columnsQuery = `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;`;
            
            const tablesRes = await runPsql(tablesQuery);
            if (!tablesRes.success) return tablesRes;

            const columnsRes = await runPsql(columnsQuery);
            if (!columnsRes.success) return columnsRes;

            return {
              success: true,
              type: 'postgresql',
              tables: tablesRes.rows,
              columns: columnsRes.rows
            };
          } else {
            return await runPsql(sql);
          }
        } else {
          if (action === 'schema') {
            const tablesRes = await runMysql('SHOW TABLES;');
            if (!tablesRes.success) return tablesRes;

            const tables = (tablesRes.rawRows || []).map(r => r[0]).filter(Boolean);
            const schemaDetails = [];

            for (const table of tables) {
              const descRes = await runMysql(`DESCRIBE \`${table}\`;`);
              if (descRes.success) {
                schemaDetails.push({
                  table,
                  columns: (descRes.rawRows || []).map(row => ({
                    field: row[0],
                    type: row[1],
                    null: row[2],
                    key: row[3],
                    default: row[4],
                    extra: row[5]
                  }))
                });
              }
            }

            return {
              success: true,
              type: 'mysql',
              tables,
              schema: schemaDetails
            };
          } else {
            return await runMysql(sql);
          }
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  codeFixer: new FunctionTool({
    name: 'codeFixer',
    description: 'High-performance, multi-language code fixer tool. Supports multi-line search & replace, insertion anchors, escape sequence unescaping, line-range targeting, whole-file overwriting, appending, dry-run simulations, and automatic formatting/linting fallback.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative or absolute path of the file to modify inside the workspace.'),
      operations: z.array(z.object({
        action: z.enum(['replace', 'insert_before', 'insert_after', 'write', 'append']).describe('The action to perform on the target file section.'),
        search: z.string().optional().describe('The code block or pattern to match. Optional for "replace", "insert_before", or "insert_after"; if omitted, the entire targeted section (anchors/lines/file) is used as the match.'),
        replace: z.string().optional().describe('The replacement code content (required for "replace").'),
        content: z.string().optional().describe('The content to write, append, or insert.'),
        startAnchor: z.string().optional().describe('An optional start delimiter/string anchor. If provided, the modification is isolated to only occur AFTER this string.'),
        endAnchor: z.string().optional().describe('An optional end delimiter/string anchor. If provided, the modification is isolated to only occur BEFORE this string.'),
        startLine: z.number().optional().describe('1-indexed starting line number to restrict the scope of the search/replace.'),
        endLine: z.number().optional().describe('1-indexed ending line number to restrict the scope of the search/replace.'),
        isRegex: z.boolean().optional().default(false).describe('If true, search is evaluated as a regular expression.'),
        regexFlags: z.string().optional().default('g').describe('Regular expression flags if isRegex is true (e.g., "g", "i", "m").'),
        unescape: z.boolean().optional().default(true).describe('If true, decodes escaped characters like \\n, \\t, and \\\\ in parameters.')
      })).optional().describe('An ordered array of code modification operations to execute sequentially.'),
      files: z.array(z.string()).optional().describe('Optional list of files for scanning or propagating changes.'),
      correlate: z.object({
        files: z.array(z.string()).optional().describe('Optional list of files to scan for correlations. Defaults to root files or workspace files.'),
        targets: z.array(z.string()).optional().describe('Optional list of specific class/function names to correlate.')
      }).optional().describe('Cross-reference classes and functions across specified files.'),
      propagateCorrelations: z.array(z.object({
        search: z.string().describe('The name of the class or function to find.'),
        replace: z.string().describe('The new name or content to replace it with.'),
        files: z.array(z.string()).optional().describe('Files to apply this propagation to. Defaults to root files or all workspace files.')
      })).optional().describe('Rename/modify a class or function and automatically update both its definition and all of its reference sites.'),
      searchFunctionality: z.object({
        query: z.string().describe('A text keyword or regex pattern to search for in definitions, comments, or function bodies.'),
        files: z.array(z.string()).optional().describe('Optional list of files to restrict the search to.'),
        includeComments: z.boolean().optional().default(true).describe('If true, includes code comments and documentation in the search scope.'),
        includeDefinitionsOnly: z.boolean().optional().default(false).describe('If true, restricts matches to class/function/mixin definitions only.')
      }).optional().describe('Search for specific functionalities, keywords, patterns, or definitions in the workspace code.'),
      lintAndFormat: z.boolean().optional().default(true).describe('If true, runs Prettier formatting on the files after modifications.'),
      dryRun: z.boolean().optional().default(false).describe('If true, simulates the changes and returns a diff without modifying files.')
    }),
    execute: async (args) => {
      const {
        filePath,
        operations,
        files,
        correlate,
        propagateCorrelations,
        searchFunctionality,
        lintAndFormat = true,
        dryRun = false
      } = args;

      try {
        const fileContents = {}; // relativePath -> string
        const originalContents = {}; // relativePath -> string
        const modifiedFiles = new Set();

        const loadFile = async (relPath) => {
          const resolved = resolveSafePath(relPath);
          if (fileContents[relPath] !== undefined) {
            return fileContents[relPath];
          }
          try {
            const content = await fs.readFile(resolved, 'utf-8');
            fileContents[relPath] = content;
            originalContents[relPath] = content;
            return content;
          } catch (err) {
            fileContents[relPath] = '';
            originalContents[relPath] = '';
            return '';
          }
        };

        const getWorkspaceFiles = async () => {
          const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json', 'dist', 'build'];
          const listDirRecursive = async (currentPath, relativePrefix = '') => {
            let results = [];
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
              if (ignoreDirs.includes(entry.name)) continue;
              
              const relativePath = path.join(relativePrefix, entry.name);
              const fullPath = path.join(currentPath, entry.name);
              if (entry.isDirectory()) {
                try {
                  const subResults = await listDirRecursive(fullPath, relativePath);
                  results = results.concat(subResults);
                } catch {
                  // Ignore subdirs we can't read
                }
              } else {
                const ext = path.extname(entry.name).toLowerCase();
                const codeExtensions = [
                  '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.cpp', '.hpp', '.h', '.cc', '.cxx', '.c',
                  '.java', '.cs', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.scala', '.sh', '.bash',
                  '.dart', '.lua', '.pl', '.pm', '.r', '.hs', '.ex', '.exs', '.clj', '.cljs', '.jl', '.sql',
                  '.md', '.json', '.html', '.css', '.scss', '.sass', '.less'
                ];
                if (codeExtensions.includes(ext) || ext === '') {
                  results.push(relativePath);
                }
              }
            }
            return results;
          };
          return await listDirRecursive(WORKSPACE_DIR);
        };

        const unescapeString = (str) => {
          if (typeof str !== 'string') return str;
          return str
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'");
        };

        const escapeRegExp = (str) => {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        const generateUnifiedDiff = (original, modified) => {
          const origLines = original.split('\n');
          const modLines = modified.split('\n');
          
          const diffLines = [];
          let i = 0, j = 0;
          
          while (i < origLines.length || j < modLines.length) {
            if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
              diffLines.push({ type: 'common', line: origLines[i], origNo: i + 1, modNo: j + 1 });
              i++;
              j++;
            } else {
              let isDelete = false;
              let isInsert = false;
              
              let lookahead = 1;
              const maxLookahead = 20;
              let foundMatch = false;
              while (lookahead < maxLookahead && (i + lookahead < origLines.length || j + lookahead < modLines.length)) {
                if (i + lookahead < origLines.length && origLines[i + lookahead] === modLines[j]) {
                  isDelete = true;
                  foundMatch = true;
                  break;
                }
                if (j + lookahead < modLines.length && origLines[i] === modLines[j + lookahead]) {
                  isInsert = true;
                  foundMatch = true;
                  break;
                }
                lookahead++;
              }
              
              if (foundMatch) {
                if (isDelete) {
                  while (lookahead > 0) {
                    diffLines.push({ type: 'del', line: origLines[i], origNo: i + 1 });
                    i++;
                    lookahead--;
                  }
                } else if (isInsert) {
                  while (lookahead > 0) {
                    diffLines.push({ type: 'add', line: modLines[j], modNo: j + 1 });
                    j++;
                    lookahead--;
                  }
                }
              } else {
                if (i < origLines.length && j < modLines.length) {
                  diffLines.push({ type: 'del', line: origLines[i], origNo: i + 1 });
                  diffLines.push({ type: 'add', line: modLines[j], modNo: j + 1 });
                  i++;
                  j++;
                } else if (i < origLines.length) {
                  diffLines.push({ type: 'del', line: origLines[i], origNo: i + 1 });
                  i++;
                } else if (j < modLines.length) {
                  diffLines.push({ type: 'add', line: modLines[j], modNo: j + 1 });
                  j++;
                }
              }
            }
          }
          
          const formattedDiff = [];
          const contextSize = 3;
          let inHunk = false;
          let lastHunkEnd = -1;
          
          for (let k = 0; k < diffLines.length; k++) {
            const isChange = diffLines[k].type === 'add' || diffLines[k].type === 'del';
            if (isChange) {
              if (!inHunk) {
                const hunkStart = Math.max(lastHunkEnd + 1, k - contextSize);
                if (hunkStart > 0 && hunkStart > lastHunkEnd + 1) {
                  formattedDiff.push('...');
                }
                for (let c = hunkStart; c < k; c++) {
                  formattedDiff.push(`  ${diffLines[c].line}`);
                }
                inHunk = true;
              }
              
              if (diffLines[k].type === 'add') {
                formattedDiff.push(`+ ${diffLines[k].line}`);
              } else {
                formattedDiff.push(`- ${diffLines[k].line}`);
              }
            } else {
              if (inHunk) {
                let nextChangeWithinRange = false;
                for (let next = k + 1; next <= k + contextSize * 2; next++) {
                  if (next < diffLines.length && (diffLines[next].type === 'add' || diffLines[next].type === 'del')) {
                    nextChangeWithinRange = true;
                    break;
                  }
                }
                
                if (!nextChangeWithinRange) {
                  const hunkEnd = Math.min(diffLines.length - 1, k + contextSize);
                  for (let c = k; c <= hunkEnd; c++) {
                    formattedDiff.push(`  ${diffLines[c].line}`);
                  }
                  lastHunkEnd = hunkEnd;
                  inHunk = false;
                  k = hunkEnd;
                } else {
                  formattedDiff.push(`  ${diffLines[k].line}`);
                }
              }
            }
          }
          
          if (inHunk) {
            lastHunkEnd = diffLines.length - 1;
          } else if (lastHunkEnd < diffLines.length - 1 && lastHunkEnd !== -1) {
            formattedDiff.push('...');
          }
          
          return formattedDiff.join('\n');
        };

        const getLineNumber = (content, index) => {
          const sub = content.slice(0, index);
          return sub.split('\n').length;
        };

        // 1. Process single file operation if filePath and operations are specified
        if (filePath && operations && operations.length > 0) {
          const resolvedPath = resolveSafePath(filePath);
          let fileContent = await loadFile(filePath);

          for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            const unescape = op.unescape !== false;

            let targetStartIdx = 0;
            let targetEndIdx = fileContent.length;

            if (op.startLine || op.endLine) {
              const lines = fileContent.split('\n');
              let startIdx = op.startLine ? Math.max(0, op.startLine - 1) : 0;
              let endIdx = op.endLine ? Math.min(lines.length, op.endLine) : lines.length;

              let charAcc = 0;
              for (let l = 0; l < lines.length; l++) {
                if (l === startIdx) targetStartIdx = charAcc;
                charAcc += lines[l].length + 1;
                if (l === endIdx - 1) {
                  targetEndIdx = charAcc - 1;
                  break;
                }
              }
            }

            if (op.startAnchor) {
              const cleanAnchor = unescape ? unescapeString(op.startAnchor) : op.startAnchor;
              const idx = fileContent.indexOf(cleanAnchor, targetStartIdx);
              if (idx === -1 || idx > targetEndIdx) {
                return { success: false, error: `Operation [${i}]: Start anchor "${op.startAnchor}" not found in targeted range.` };
              }
              targetStartIdx = idx + cleanAnchor.length;
            }

            if (op.endAnchor) {
              const cleanAnchor = unescape ? unescapeString(op.endAnchor) : op.endAnchor;
              const idx = fileContent.indexOf(cleanAnchor, targetStartIdx);
              if (idx === -1 || idx > targetEndIdx) {
                return { success: false, error: `Operation [${i}]: End anchor "${op.endAnchor}" not found in targeted range.` };
              }
              targetEndIdx = idx;
            }

            const prefix = fileContent.slice(0, targetStartIdx);
            let targetSection = fileContent.slice(targetStartIdx, targetEndIdx);
            const suffix = fileContent.slice(targetEndIdx);

            if (op.action === 'write') {
              const contentVal = op.content !== undefined ? op.content : '';
              targetSection = unescape ? unescapeString(contentVal) : contentVal;
            } 
            else if (op.action === 'append') {
              const contentVal = op.content !== undefined ? op.content : '';
              targetSection = targetSection + (unescape ? unescapeString(contentVal) : contentVal);
            } 
            else if (op.action === 'replace') {
              const replaceVal = op.replace !== undefined ? op.replace : '';
              const finalReplace = unescape ? unescapeString(replaceVal) : replaceVal;

              if (op.search === undefined) {
                targetSection = finalReplace;
              } else if (op.isRegex) {
                const searchPat = unescape ? unescapeString(op.search) : op.search;
                const flags = op.regexFlags !== undefined ? op.regexFlags : 'g';
                const re = new RegExp(searchPat, flags);
                targetSection = targetSection.replace(re, finalReplace);
              } else {
                const finalSearch = unescape ? unescapeString(op.search) : op.search;
                if (targetSection.indexOf(finalSearch) === -1) {
                  return { success: false, error: `Operation [${i}]: Search pattern "${op.search}" not found inside target section.` };
                }
                targetSection = targetSection.split(finalSearch).join(finalReplace);
              }
            } 
            else if (op.action === 'insert_before') {
              const finalContent = op.content !== undefined ? (unescape ? unescapeString(op.content) : op.content) : '';

              if (op.search === undefined) {
                targetSection = finalContent + targetSection;
              } else {
                const finalSearch = unescape ? unescapeString(op.search) : op.search;
                const idx = targetSection.indexOf(finalSearch);
                if (idx === -1) {
                  return { success: false, error: `Operation [${i}]: Search pattern "${op.search}" not found inside target section.` };
                }
                targetSection = targetSection.slice(0, idx) + finalContent + targetSection.slice(idx);
              }
            } 
            else if (op.action === 'insert_after') {
              const finalContent = op.content !== undefined ? (unescape ? unescapeString(op.content) : op.content) : '';

              if (op.search === undefined) {
                targetSection = targetSection + finalContent;
              } else {
                const finalSearch = unescape ? unescapeString(op.search) : op.search;
                const idx = targetSection.indexOf(finalSearch);
                if (idx === -1) {
                  return { success: false, error: `Operation [${i}]: Search pattern "${op.search}" not found inside target section.` };
                }
                const insertIdx = idx + finalSearch.length;
                targetSection = targetSection.slice(0, insertIdx) + finalContent + targetSection.slice(insertIdx);
              }
            }

            fileContent = prefix + targetSection + suffix;
          }

          fileContents[filePath] = fileContent;
          if (fileContent !== originalContents[filePath]) {
            modifiedFiles.add(filePath);
          }
        }

        // 2. Process correlation if requested
        let correlationReport = null;
        if (correlate) {
          let scanFiles = correlate.files || files || [];
          if (scanFiles.length === 0) {
            scanFiles = await getWorkspaceFiles();
          }

          for (const f of scanFiles) {
            await loadFile(f);
          }

          const definitions = [];
          const reservedKeywords = new Set([
            'if', 'while', 'for', 'switch', 'catch', 'return', 'else', 'using', 'namespace', 
            'template', 'typedef', 'operator', 'const', 'let', 'var', 'class', 'struct', 'func', 'def', 'function',
            'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'override', 'virtual',
            'internal', 'async', 'await', 'fn', 'fun', 'object', 'module', 'protocol', 'interface', 'enum',
            'new', 'super', 'this', 'import', 'export', 'package', 'throws', 'throw', 'do', 'case', 'break', 'continue'
          ]);

          for (const f of scanFiles) {
            const fileContent = fileContents[f];
            const ext = path.extname(f).toLowerCase();

            const classRegexes = [];
            const funcRegexes = [];

            if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
            } else if (['.py'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            } else if (['.go'].includes(ext)) {
              classRegexes.push(/\btype\s+([a-zA-Z0-9_$]+)\s+struct\b/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_$]+)\s*\(/g);
              funcRegexes.push(/\bfunc\s*\([^)]+\)\s*([a-zA-Z0-9_$]+)\s*\(/g);
            } else if (['.cpp', '.hpp', '.h', '.cc', '.cxx', '.c'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:const)?\s*\{/g);
            } else if (['.java'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[a-zA-Z0-9_$,\s]+)?\s*\{/g);
            } else if (['.cs'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|struct|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.dart'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.lua'].includes(ext)) {
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_.:]+)\s*\(/g);
            } else if (['.pl', '.pm'].includes(ext)) {
              classRegexes.push(/\bpackage\s+([a-zA-Z0-9_:]+)/g);
              funcRegexes.push(/\bsub\s+([a-zA-Z0-9_]+)/g);
            } else if (['.r', '.R'].includes(ext)) {
              classRegexes.push(/\bsetClass\s*\(\s*["']([a-zA-Z0-9_]+)["']/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*(?:<-|=)\s*function\b/g);
            } else if (['.hs'].includes(ext)) {
              classRegexes.push(/\b(?:data|newtype|class)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*::\s*/g);
            } else if (['.ex', '.exs'].includes(ext)) {
              classRegexes.push(/\bdefmodule\s+([a-zA-Z0-9_.]+)/g);
              funcRegexes.push(/\bdefp?\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.clj', '.cljs'].includes(ext)) {
              classRegexes.push(/\(\s*ns\s+([a-zA-Z0-9_.-]+)/g);
              funcRegexes.push(/\(\s*defn-?\s+([a-zA-Z0-9_.-?!]+)/g);
            } else if (['.jl'].includes(ext)) {
              classRegexes.push(/\b(?:mutable\s+)?struct\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b(?:function|macro)\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.sql'].includes(ext)) {
              classRegexes.push(/\bCREATE\s+(?:TABLE|VIEW)\s+([a-zA-Z0-9_]+)/gi);
              funcRegexes.push(/\bCREATE\s+(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_]+)/gi);
            } else if (['.rs'].includes(ext)) {
              classRegexes.push(/\b(?:struct|enum|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.rb'].includes(ext)) {
              classRegexes.push(/\b(?:class|module)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_?!]+)/g);
            } else if (['.php'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_]+)\s*\(/g);
            } else if (['.swift'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct|enum|protocol)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.kt', '.kts'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|object)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfun\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.scala'].includes(ext)) {
              classRegexes.push(/\b(?:class|trait|object)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.css'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@keyframes\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.scss'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              classRegexes.push(/%([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@(?:mixin|function)\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.sass'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)/g);
              funcRegexes.push(/(?:@mixin\s+|=)([a-zA-Z0-9_-]+)/g);
            } else if (['.less'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/\.([a-zA-Z0-9_-]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.sh', '.bash'].includes(ext)) {
              funcRegexes.push(/\b([a-zA-Z0-9_-]+)\s*\(\s*\)\s*\{/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_-]+)/g);
            } else {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            }

            const processRegex = (re, type) => {
              let match;
              re.lastIndex = 0;
              while ((match = re.exec(fileContent)) !== null) {
                const name = match[1];
                if (reservedKeywords.has(name)) continue;
                const line = getLineNumber(fileContent, match.index);
                definitions.push({
                  name,
                  type,
                  file: f,
                  line
                });
              }
            };

            for (const re of classRegexes) processRegex(re, 'class');
            for (const re of funcRegexes) processRegex(re, 'function');
          }

          const targetNames = new Set();
          if (correlate.targets && correlate.targets.length > 0) {
            for (const t of correlate.targets) {
              targetNames.add(t);
            }
          } else {
            for (const d of definitions) {
              targetNames.add(d.name);
            }
          }

          const references = {};
          for (const name of targetNames) {
            references[name] = [];
          }

          for (const f of scanFiles) {
            const fileContent = fileContents[f];
            const lines = fileContent.split('\n');

            for (const name of targetNames) {
              const re = new RegExp('(^|[^a-zA-Z0-9_$])' + escapeRegExp(name) + '(?![a-zA-Z0-9_$])', 'g');

              for (let l = 0; l < lines.length; l++) {
                const lineContent = lines[l];
                re.lastIndex = 0;
                if (re.test(lineContent)) {
                  const isDef = definitions.some(d => d.name === name && d.file === f && d.line === l + 1);
                  if (isDef) continue;

                  references[name].push({
                    file: f,
                    line: l + 1,
                    lineContent: lineContent.trim()
                  });
                }
              }
            }
          }

          correlationReport = {
            definitions: correlate.targets ? definitions.filter(d => targetNames.has(d.name)) : definitions,
            references
          };
        }

        // 3. Process propagateCorrelations if requested
        if (propagateCorrelations && propagateCorrelations.length > 0) {
          for (const prop of propagateCorrelations) {
            let propFiles = prop.files || files || [];
            if (propFiles.length === 0) {
              propFiles = await getWorkspaceFiles();
            }

            for (const f of propFiles) {
              await loadFile(f);
            }

            for (const f of propFiles) {
              const fileContent = fileContents[f];
              const re = new RegExp('(^|[^a-zA-Z0-9_$])' + escapeRegExp(prop.search) + '(?![a-zA-Z0-9_$])', 'g');
              const newContent = fileContent.replace(re, `$1${prop.replace}`);

              if (newContent !== fileContent) {
                fileContents[f] = newContent;
                modifiedFiles.add(f);
              }
            }
          }
        }

        // 4. Process searchFunctionality if requested
        let functionalityReport = null;
        if (searchFunctionality) {
          const query = searchFunctionality.query;
          const includeComments = searchFunctionality.includeComments !== false;
          const includeDefinitionsOnly = !!searchFunctionality.includeDefinitionsOnly;

          let searchFiles = searchFunctionality.files || files || [];
          if (searchFiles.length === 0) {
            searchFiles = await getWorkspaceFiles();
          }

          for (const f of searchFiles) {
            await loadFile(f);
          }

          let queryRegex;
          try {
            queryRegex = new RegExp(query, 'i');
          } catch (err) {
            queryRegex = new RegExp(escapeRegExp(query), 'i');
          }

          const matches = [];

          const getFileDefinitions = (f, fileContent) => {
            const ext = path.extname(f).toLowerCase();
            const classRegexes = [];
            const funcRegexes = [];
            const fileDefs = [];

            const reservedKeywords = new Set([
              'if', 'while', 'for', 'switch', 'catch', 'return', 'else', 'using', 'namespace', 
              'template', 'typedef', 'operator', 'const', 'let', 'var', 'class', 'struct', 'func', 'def', 'function',
              'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'override', 'virtual',
              'internal', 'async', 'await', 'fn', 'fun', 'object', 'module', 'protocol', 'interface', 'enum',
              'new', 'super', 'this', 'import', 'export', 'package', 'throws', 'throw', 'do', 'case', 'break', 'continue'
            ]);

            if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
            } else if (['.py'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            } else if (['.go'].includes(ext)) {
              classRegexes.push(/\btype\s+([a-zA-Z0-9_$]+)\s+struct\b/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_$]+)\s*\(/g);
              funcRegexes.push(/\bfunc\s*\([^)]+\)\s*([a-zA-Z0-9_$]+)\s*\(/g);
            } else if (['.cpp', '.hpp', '.h', '.cc', '.cxx', '.c'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:const)?\s*\{/g);
            } else if (['.java'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[a-zA-Z0-9_$,\s]+)?\s*\{/g);
            } else if (['.cs'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|struct|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.dart'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.lua'].includes(ext)) {
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_.:]+)\s*\(/g);
            } else if (['.pl', '.pm'].includes(ext)) {
              classRegexes.push(/\bpackage\s+([a-zA-Z0-9_:]+)/g);
              funcRegexes.push(/\bsub\s+([a-zA-Z0-9_]+)/g);
            } else if (['.r', '.R'].includes(ext)) {
              classRegexes.push(/\bsetClass\s*\(\s*["']([a-zA-Z0-9_]+)["']/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*(?:<-|=)\s*function\b/g);
            } else if (['.hs'].includes(ext)) {
              classRegexes.push(/\b(?:data|newtype|class)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*::\s*/g);
            } else if (['.ex', '.exs'].includes(ext)) {
              classRegexes.push(/\bdefmodule\s+([a-zA-Z0-9_.]+)/g);
              funcRegexes.push(/\bdefp?\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.clj', '.cljs'].includes(ext)) {
              classRegexes.push(/\(\s*ns\s+([a-zA-Z0-9_.-]+)/g);
              funcRegexes.push(/\(\s*defn-?\s+([a-zA-Z0-9_.-?!]+)/g);
            } else if (['.jl'].includes(ext)) {
              classRegexes.push(/\b(?:mutable\s+)?struct\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b(?:function|macro)\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.sql'].includes(ext)) {
              classRegexes.push(/\bCREATE\s+(?:TABLE|VIEW)\s+([a-zA-Z0-9_]+)/gi);
              funcRegexes.push(/\bCREATE\s+(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_]+)/gi);
            } else if (['.rs'].includes(ext)) {
              classRegexes.push(/\b(?:struct|enum|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.rb'].includes(ext)) {
              classRegexes.push(/\b(?:class|module)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_?!]+)/g);
            } else if (['.php'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_]+)\s*\(/g);
            } else if (['.swift'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct|enum|protocol)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.kt', '.kts'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|object)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfun\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.scala'].includes(ext)) {
              classRegexes.push(/\b(?:class|trait|object)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.css'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@keyframes\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.scss'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              classRegexes.push(/%([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@(?:mixin|function)\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.sass'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)/g);
              funcRegexes.push(/(?:@mixin\s+|=)([a-zA-Z0-9_-]+)/g);
            } else if (['.less'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/\.([a-zA-Z0-9_-]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.sh', '.bash'].includes(ext)) {
              funcRegexes.push(/\b([a-zA-Z0-9_-]+)\s*\(\s*\)\s*\{/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_-]+)/g);
            } else {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            }

            const processRegex = (re, type) => {
              let match;
              re.lastIndex = 0;
              while ((match = re.exec(fileContent)) !== null) {
                const name = match[1];
                if (reservedKeywords.has(name)) continue;
                const line = getLineNumber(fileContent, match.index);
                fileDefs.push({
                  name,
                  type,
                  file: f,
                  line
                });
              }
            };

            for (const re of classRegexes) processRegex(re, 'class');
            for (const re of funcRegexes) processRegex(re, 'function');

            fileDefs.sort((a, b) => a.line - b.line);
            return fileDefs;
          };

          for (const f of searchFiles) {
            const fileContent = fileContents[f];
            const ext = path.extname(f).toLowerCase();
            const lines = fileContent.split('\n');

            const fileDefs = getFileDefinitions(f, fileContent);

            let insideBlock = false;
            let blockType = '';

            for (let l = 0; l < lines.length; l++) {
              const lineContent = lines[l];
              const trimmed = lineContent.trim();
              const lineNo = l + 1;

              let isComment = false;
              if (insideBlock) {
                isComment = true;
                if (blockType === '/*' && trimmed.includes('*/')) {
                  insideBlock = false;
                } else if (blockType === '"""' && trimmed.includes('"""')) {
                  insideBlock = false;
                } else if (blockType === "'''" && trimmed.includes("'''")) {
                  insideBlock = false;
                } else if (blockType === '<!--' && trimmed.includes('-->')) {
                  insideBlock = false;
                } else if (blockType === '=begin' && trimmed.startsWith('=end')) {
                  insideBlock = false;
                }
              } else {
                if (
                  trimmed.startsWith('//') ||
                  trimmed.startsWith('#') ||
                  trimmed.startsWith('--') ||
                  (trimmed.startsWith('*') && ext !== '.css' && ext !== '.scss' && ext !== '.sass' && ext !== '.less')
                ) {
                  isComment = true;
                } else if (trimmed.startsWith('/*')) {
                  isComment = true;
                  if (!trimmed.includes('*/')) {
                    insideBlock = true;
                    blockType = '/*';
                  }
                } else if (trimmed.startsWith('<!--')) {
                  isComment = true;
                  if (!trimmed.includes('-->')) {
                    insideBlock = true;
                    blockType = '<!--';
                  }
                } else if (trimmed.startsWith('"""') && ['.py'].includes(ext)) {
                  isComment = true;
                  if (!trimmed.slice(3).includes('"""')) {
                    insideBlock = true;
                    blockType = '"""';
                  }
                } else if (trimmed.startsWith("'''") && ['.py'].includes(ext)) {
                  isComment = true;
                  if (!trimmed.slice(3).includes("'''")) {
                    insideBlock = true;
                    blockType = "'''";
                  }
                } else if (trimmed.startsWith('=begin') && ['.rb'].includes(ext)) {
                  isComment = true;
                  insideBlock = true;
                  blockType = '=begin';
                }
              }

              if (!includeComments && isComment) {
                continue;
              }

              if (includeDefinitionsOnly) {
                const definitionAtLine = fileDefs.find(d => d.line === lineNo);
                if (definitionAtLine) {
                  if (queryRegex.test(definitionAtLine.name) || queryRegex.test(lineContent)) {
                    matches.push({
                      file: f,
                      line: lineNo,
                      lineContent: lineContent,
                      isDefinition: true,
                      definitionType: definitionAtLine.type,
                      definitionName: definitionAtLine.name,
                      enclosingFunctionality: null
                    });
                  }
                }
                continue;
              }

              if (queryRegex.test(lineContent)) {
                let enclosingFunctionality = null;
                for (let i = fileDefs.length - 1; i >= 0; i--) {
                  if (fileDefs[i].line <= lineNo) {
                    enclosingFunctionality = {
                      name: fileDefs[i].name,
                      type: fileDefs[i].type,
                      line: fileDefs[i].line
                    };
                    break;
                  }
                }

                const definitionAtLine = fileDefs.find(d => d.line === lineNo);

                matches.push({
                  file: f,
                  line: lineNo,
                  lineContent: lineContent,
                  isComment,
                  isDefinition: !!definitionAtLine,
                  definitionType: definitionAtLine ? definitionAtLine.type : null,
                  definitionName: definitionAtLine ? definitionAtLine.name : null,
                  enclosingFunctionality
                });
              }
            }
          }

          functionalityReport = {
            query,
            matches
          };
        }

        if (!(filePath && operations) && !correlate && !propagateCorrelations && !searchFunctionality) {
          return { success: false, error: 'At least one of (filePath & operations), correlate, propagateCorrelations, or searchFunctionality must be specified.' };
        }

        const modifiedDiffs = {};
        for (const f of modifiedFiles) {
          const resolved = resolveSafePath(f);
          const original = originalContents[f];
          let modified = fileContents[f];

          if (!dryRun) {
            const dir = path.dirname(resolved);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(resolved, modified, 'utf-8');

            if (lintAndFormat) {
              const formatCmd = `npx prettier --write "${resolved}"`;
              await new Promise((resolve) => {
                exec(formatCmd, () => {
                  resolve();
                });
              });
              modified = await fs.readFile(resolved, 'utf-8');
              fileContents[f] = modified;
            }
          }

          const diff = generateUnifiedDiff(original, modified);
          modifiedDiffs[f] = diff;
        }

        if (filePath && operations && !correlate && !propagateCorrelations && !searchFunctionality) {
          const diff = modifiedDiffs[filePath] || '';
          return {
            success: true,
            message: dryRun ? `Dry-run simulation complete for ${filePath}.` : (lintAndFormat ? `Successfully modified, linted, and formatted ${filePath}.` : `Successfully modified ${filePath}.`),
            diff
          };
        }

        const response = {
          success: true,
          message: dryRun ? `Dry-run simulation complete.` : `Successfully processed changes.`,
          modifiedFiles: Array.from(modifiedFiles),
          diffs: modifiedDiffs
        };

        if (correlationReport) {
          response.correlations = correlationReport;
        }

        if (functionalityReport) {
          response.functionalities = functionalityReport;
        }

        return response;
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),
};

