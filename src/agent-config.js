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

let llmProvider = process.env.LLM_PROVIDER || 'ollama';

export function getLlmProvider() {
  return llmProvider;
}

export function setLlmProvider(provider) {
  if (provider && (provider.toLowerCase() === 'lmstudio' || provider.toLowerCase() === 'lm-studio')) {
    llmProvider = 'lmstudio';
  } else {
    llmProvider = 'ollama';
  }
  process.env.LLM_PROVIDER = llmProvider;
  triggerConfigChange();
}

let ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
let lmStudioHost = process.env.LMSTUDIO_HOST || 'http://localhost:1234';

export function getOllamaHost() {
  if (!ollamaHost.startsWith('http://') && !ollamaHost.startsWith('https://')) {
    ollamaHost = 'http://' + ollamaHost;
  }
  if (ollamaHost.endsWith('/')) {
    ollamaHost = ollamaHost.slice(0, -1);
  }
  return ollamaHost;
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
  triggerConfigChange();
}

export function getLmStudioHost() {
  if (!lmStudioHost.startsWith('http://') && !lmStudioHost.startsWith('https://')) {
    lmStudioHost = 'http://' + lmStudioHost;
  }
  if (lmStudioHost.endsWith('/')) {
    lmStudioHost = lmStudioHost.slice(0, -1);
  }
  return lmStudioHost;
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
  triggerConfigChange();
}

// Resolve the active server base URL
export function getOllamaBaseUrl() {
  return llmProvider === 'lmstudio' ? getLmStudioHost() : getOllamaHost();
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
  if (llmProvider === 'lmstudio') {
    setLmStudioHost(url);
  } else {
    setOllamaHost(url);
  }
}

let ollamaAuth = process.env.OLLAMA_AUTH || '';
let lmStudioAuth = process.env.LMSTUDIO_AUTH || '';

export function getOllamaAuth() {
  return ollamaAuth;
}

export function setOllamaAuth(auth) {
  ollamaAuth = auth ? auth.trim() : '';
  process.env.OLLAMA_AUTH = ollamaAuth;
  triggerConfigChange();
}

export function getLmStudioAuth() {
  return lmStudioAuth;
}

export function setLmStudioAuth(auth) {
  lmStudioAuth = auth ? auth.trim() : '';
  process.env.LMSTUDIO_AUTH = lmStudioAuth;
  triggerConfigChange();
}

export function getOllamaHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const auth = llmProvider === 'lmstudio' ? getLmStudioAuth() : getOllamaAuth();
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
