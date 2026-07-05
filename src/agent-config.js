import { getLogger, setLogger } from '@google/adk';

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

// Resolve the Ollama server base URL from environment or fallback to localhost
export function getOllamaBaseUrl() {
  let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = 'http://' + host;
  }
  if (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
  return host;
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
  if (!url) return;
  let formattedUrl = url.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'http://' + formattedUrl;
  }
  if (formattedUrl.endsWith('/')) {
    formattedUrl = formattedUrl.slice(0, -1);
  }
  process.env.OLLAMA_HOST = formattedUrl;
  triggerConfigChange();
}

let ollamaAuth = process.env.OLLAMA_AUTH || '';

export function getOllamaAuth() {
  return ollamaAuth;
}

export function setOllamaAuth(auth) {
  ollamaAuth = auth ? auth.trim() : '';
  process.env.OLLAMA_AUTH = ollamaAuth;
  triggerConfigChange();
}

export function getOllamaHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const auth = getOllamaAuth();
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
