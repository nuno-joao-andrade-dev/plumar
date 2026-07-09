import { getLogger, setLogger } from '@google/adk';
import fs from 'node:fs';
import path from 'node:path';

const originalLogger = getLogger();

let adkInfoEnabled = process.env.ADK_INFO === 'true';

// By default, ADK logging is disabled
if (!adkInfoEnabled) {
  setLogger(null);
}

export function isAdkInfoEnabled() {
  return adkInfoEnabled;
}

export function setAdkInfoEnabled(enabled) {
  adkInfoEnabled = !!enabled;
  if (adkInfoEnabled) {
    setLogger(originalLogger);
  } else {
    setLogger(null);
  }
}

let verboseJsonEnabled = process.env.VERBOSE === 'true' || process.env.VERBOSE_JSON === 'true';

export function isVerboseJsonEnabled() {
  return verboseJsonEnabled;
}

export function setVerboseJsonEnabled(enabled) {
  verboseJsonEnabled = !!enabled;
}

function getSettingsPath() {
  return path.join(process.cwd(), '.plumar', 'settings.json');
}

export function loadProviderSettings() {
  if (process.argv.some(arg => arg.includes('test')) && !process.cwd().includes('temp')) {
    return;
  }
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed) {
        if (parsed.llmProvider !== undefined) {
          llmProvider = parsed.llmProvider;
        } else if (parsed.provider && parsed.provider.type !== undefined) {
          llmProvider = parsed.provider.type;
        } else if (parsed.provider && parsed.provider.llmProvider !== undefined) {
          llmProvider = parsed.provider.llmProvider;
        }

        if (parsed.ollamaHost !== undefined) {
          ollamaHost = parsed.ollamaHost;
        } else if (parsed.provider && parsed.provider.ollamaHost !== undefined) {
          ollamaHost = parsed.provider.ollamaHost;
        }

        if (parsed.lmStudioHost !== undefined) {
          lmStudioHost = parsed.lmStudioHost;
        } else if (parsed.provider && parsed.provider.lmStudioHost !== undefined) {
          lmStudioHost = parsed.provider.lmStudioHost;
        }

        if (parsed.ollamaAuth !== undefined) {
          ollamaAuth = parsed.ollamaAuth;
        } else if (parsed.provider && parsed.provider.ollamaAuth !== undefined) {
          ollamaAuth = parsed.provider.ollamaAuth;
        }

        if (parsed.lmStudioAuth !== undefined) {
          lmStudioAuth = parsed.lmStudioAuth;
        } else if (parsed.provider && parsed.provider.lmStudioAuth !== undefined) {
          lmStudioAuth = parsed.provider.lmStudioAuth;
        }
      }
    } catch (err) {
      // ignore
    }
  }
}

export function saveProviderSettings() {
  if (process.argv.some(arg => arg.includes('test')) && !process.cwd().includes('temp')) {
    return;
  }
  const settingsPath = getSettingsPath();
  const settingsDir = path.dirname(settingsPath);
  let parsed = {};

  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      parsed = JSON.parse(content) || {};
    } catch (err) {
      // ignore
    }
  }

  parsed.llmProvider = llmProvider;
  parsed.ollamaHost = ollamaHost;
  parsed.lmStudioHost = lmStudioHost;
  parsed.ollamaAuth = ollamaAuth;
  parsed.lmStudioAuth = lmStudioAuth;

  if (!parsed.provider) {
    parsed.provider = {};
  }
  parsed.provider.type = llmProvider;
  parsed.provider.llmProvider = llmProvider;
  parsed.provider.ollamaHost = ollamaHost;
  parsed.provider.lmStudioHost = lmStudioHost;
  parsed.provider.ollamaAuth = ollamaAuth;
  parsed.provider.lmStudioAuth = lmStudioAuth;

  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error saving provider settings to ${settingsPath}:`, err.message);
  }
}

let llmProvider = 'ollama';
let ollamaHost = 'http://localhost:11434';
let lmStudioHost = 'http://localhost:1234';
let ollamaAuth = '';
let lmStudioAuth = '';

// Load saved settings from settings file
loadProviderSettings();

// Environment variables still override if explicitly provided
if (process.env.LLM_PROVIDER) {
  llmProvider = process.env.LLM_PROVIDER;
}
if (process.env.OLLAMA_HOST) {
  ollamaHost = process.env.OLLAMA_HOST;
}
if (process.env.LMSTUDIO_HOST) {
  lmStudioHost = process.env.LMSTUDIO_HOST;
}
if (process.env.OLLAMA_AUTH) {
  ollamaAuth = process.env.OLLAMA_AUTH;
}
if (process.env.LMSTUDIO_AUTH) {
  lmStudioAuth = process.env.LMSTUDIO_AUTH;
}

// Keep process.env in sync
process.env.LLM_PROVIDER = llmProvider;
process.env.OLLAMA_HOST = ollamaHost;
process.env.LMSTUDIO_HOST = lmStudioHost;
process.env.OLLAMA_AUTH = ollamaAuth;
process.env.LMSTUDIO_AUTH = lmStudioAuth;

export function getLlmProvider() {
  return process.env.LLM_PROVIDER || llmProvider;
}

export function setLlmProvider(provider) {
  if (provider && (provider.toLowerCase() === 'lmstudio' || provider.toLowerCase() === 'lm-studio')) {
    llmProvider = 'lmstudio';
  } else {
    llmProvider = 'ollama';
  }
  process.env.LLM_PROVIDER = llmProvider;
  saveProviderSettings();
  triggerConfigChange();
}

export function getOllamaHost() {
  let host = process.env.OLLAMA_HOST || ollamaHost;
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = 'http://' + host;
  }
  if (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
  return host;
}

export function setOllamaHost(url) {
  if (!url) return;
  let formattedUrl = url.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'http://' + formattedUrl;
  }
  if (formattedUrl.endsWith('/')) {
    formattedUrl = formattedUrl.slice(0, -1);
  }
  ollamaHost = formattedUrl;
  process.env.OLLAMA_HOST = formattedUrl;
  saveProviderSettings();
  triggerConfigChange();
}

export function getLmStudioHost() {
  let host = process.env.LMSTUDIO_HOST || lmStudioHost;
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = 'http://' + host;
  }
  if (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
  return host;
}

export function setLmStudioHost(url) {
  if (!url) return;
  let formattedUrl = url.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'http://' + formattedUrl;
  }
  if (formattedUrl.endsWith('/')) {
    formattedUrl = formattedUrl.slice(0, -1);
  }
  lmStudioHost = formattedUrl;
  process.env.LMSTUDIO_HOST = formattedUrl;
  saveProviderSettings();
  triggerConfigChange();
}

// Resolve the active server base URL
export function getOllamaBaseUrl() {
  return getLlmProvider() === 'lmstudio' ? getLmStudioHost() : getOllamaHost();
}

let onConfigChangeCallback = null;
export function registerConfigChangeCallback(callback) {
  onConfigChangeCallback = callback;
}

function triggerConfigChange() {
  if (onConfigChangeCallback) {
    onConfigChangeCallback();
  }
}

// Allow dynamic, in-session server host switching
export function setOllamaBaseUrl(url) {
  if (getLlmProvider() === 'lmstudio') {
    setLmStudioHost(url);
  } else {
    setOllamaHost(url);
  }
}

export function getOllamaAuth() {
  return process.env.OLLAMA_AUTH || ollamaAuth;
}

export function setOllamaAuth(auth) {
  ollamaAuth = auth ? auth.trim() : '';
  process.env.OLLAMA_AUTH = ollamaAuth;
  saveProviderSettings();
  triggerConfigChange();
}

export function getLmStudioAuth() {
  return process.env.LMSTUDIO_AUTH || lmStudioAuth;
}

export function setLmStudioAuth(auth) {
  lmStudioAuth = auth ? auth.trim() : '';
  process.env.LMSTUDIO_AUTH = lmStudioAuth;
  saveProviderSettings();
  triggerConfigChange();
}

export function getOllamaHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const auth = getLlmProvider() === 'lmstudio' ? getLmStudioAuth() : getOllamaAuth();
  if (auth) {
    if (auth.includes(':')) {
      const index = auth.indexOf(':');
      const hName = auth.slice(0, index).trim();
      const hValue = auth.slice(index + 1).trim();
      headers[hName] = hValue;
    } else {
      headers['Authorization'] = auth.startsWith('Bearer ') || auth.startsWith('Basic ') ? auth : `Bearer ${auth}`;
    }
  }
  return headers;
}

const modelDetailsCache = {};

export async function getModelDetails(modelName) {
  if (!modelName) return null;
  if (getLlmProvider() === 'lmstudio') {
    return {
      details: {
        family: '',
        families: []
      },
      model_info: {
        'general.architecture': ''
      }
    };
  }
  if (modelDetailsCache[modelName]) {
    return modelDetailsCache[modelName];
  }
  try {
    const baseUrl = getOllamaBaseUrl();
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: getOllamaHeaders(),
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data = await response.json();
      modelDetailsCache[modelName] = data;
      return data;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

export async function getModelContextLength(modelName) {
  if (!modelName) return 16384;
  const data = await getModelDetails(modelName);
  if (data && data.model_info) {
    for (const [key, val] of Object.entries(data.model_info)) {
      if (key.endsWith('.context_length') && typeof val === 'number') {
        return val;
      }
    }
    for (const [key, val] of Object.entries(data.model_info)) {
      if (key.includes('context_length') && typeof val === 'number') {
        return val;
      }
    }
  }
  // Default fallback context window
  return 16384;
}
