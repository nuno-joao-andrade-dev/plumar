import { FunctionTool } from '@google/adk';
import { tools as rawTools } from './tools.js';
import { printToolCall, printToolResult } from './formatter.js';
import { 
  getOllamaBaseUrl, 
  setOllamaBaseUrl, 
  getOllamaAuth, 
  setOllamaAuth, 
  registerConfigChangeCallback 
} from './agent-config.js';
import pc from 'picocolors';
import fs from 'node:fs';

// Map registered tools
export const tools = {};
for (const [name, toolObj] of Object.entries(rawTools)) {
  tools[name] = toolObj;
}

// Dynamically register external MCP server tools
export function registerMcpTools(mcpToolsList) {
  for (const [name, toolObj] of Object.entries(mcpToolsList)) {
    tools[name] = toolObj;
  }
}

let defaultPolicy = 'ask'; // 'allow', 'ask', 'deny'
const toolPolicies = {};     // Map of toolName -> 'allow' | 'ask' | 'deny'
let activeRl = null;
let activePolicyConfigFile = null;

export function setReadlineInterface(rl) {
  activeRl = rl;
}

export function getActivePolicyConfigFile() {
  return activePolicyConfigFile;
}

export function setActivePolicyConfigFile(filepath) {
  activePolicyConfigFile = filepath;
}

export function loadPolicyConfig(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      if (data.default) {
        const p = typeof data.default === 'string' ? data.default.trim().toLowerCase() : '';
        if (['allow', 'ask', 'deny'].includes(p)) {
          defaultPolicy = p;
        }
      }
      if (data.tools && typeof data.tools === 'object') {
        for (const key of Object.keys(toolPolicies)) {
          delete toolPolicies[key];
        }
        for (const [toolName, policy] of Object.entries(data.tools)) {
          if (policy === null || policy === undefined) {
            delete toolPolicies[toolName];
          } else {
            const p = typeof policy === 'string' ? policy.trim().toLowerCase() : '';
            if (['allow', 'ask', 'deny'].includes(p)) {
              toolPolicies[toolName] = p;
            }
          }
        }
      }
      if (data.settings && typeof data.settings === 'object') {
        if (data.settings.ollamaEndpoint) {
          setOllamaBaseUrl(data.settings.ollamaEndpoint);
        }
        if (data.settings.ollamaAuth) {
          setOllamaAuth(data.settings.ollamaAuth);
        }
      } else if (data.ollamaEndpoint) {
        setOllamaBaseUrl(data.ollamaEndpoint);
      }
      activePolicyConfigFile = filepath;
      return true;
    }
  } catch (err) {
    console.error(pc.red(`\n⚠️  Error loading policy configuration from ${filepath}: ${err.message}`));
  }
  return false;
}

export function savePolicyConfig(filepath) {
  try {
    const configData = {
      default: defaultPolicy,
      tools: toolPolicies,
      settings: {
        ollamaEndpoint: getOllamaBaseUrl(),
        ollamaAuth: getOllamaAuth()
      }
    };
    fs.writeFileSync(filepath, JSON.stringify(configData, null, 2), 'utf8');
    activePolicyConfigFile = filepath;
    return true;
  } catch (err) {
    console.error(pc.red(`\n⚠️  Error saving policy configuration to ${filepath}: ${err.message}`));
  }
  return false;
}

// Register config change callback to persist when Ollama host/auth is changed
registerConfigChangeCallback(() => {
  if (activePolicyConfigFile) {
    savePolicyConfig(activePolicyConfigFile);
  }
});

export function setDefaultPolicy(policy) {
  const p = typeof policy === 'string' ? policy.trim().toLowerCase() : '';
  if (['allow', 'ask', 'deny'].includes(p)) {
    defaultPolicy = p;
    if (activePolicyConfigFile) {
      savePolicyConfig(activePolicyConfigFile);
    }
  }
}

export function getDefaultPolicy() {
  return defaultPolicy;
}

export function setToolPolicy(toolName, policy) {
  if (policy === null || policy === undefined) {
    delete toolPolicies[toolName];
    if (activePolicyConfigFile) {
      savePolicyConfig(activePolicyConfigFile);
    }
    return;
  }
  const p = typeof policy === 'string' ? policy.trim().toLowerCase() : '';
  if (['allow', 'ask', 'deny'].includes(p)) {
    toolPolicies[toolName] = p;
    if (activePolicyConfigFile) {
      savePolicyConfig(activePolicyConfigFile);
    }
  }
}

export function getToolPolicy(toolName) {
  return toolPolicies[toolName] || defaultPolicy;
}

export function getAllToolPolicies() {
  return {
    default: defaultPolicy,
    overrides: { ...toolPolicies }
  };
}

export async function checkToolPermission(toolName, args) {
  const policy = getToolPolicy(toolName);
  if (policy === 'allow') {
    return true;
  }
  if (policy === 'deny') {
    console.log(pc.red(`\n🚫 [Policy Block] Tool "${pc.bold(toolName)}" execution blocked by user policy.`));
    return false;
  }
  
  // policy is 'ask'
  if (!activeRl) {
    // If no readline interface is registered (e.g. running in automated tests), default to allowed
    return true;
  }
  
  // Temporarily turn off raw mode so normal line-by-line input works
  const oldRawMode = process.stdin.isRaw;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  
  console.log(pc.yellow(`\n❓ [Policy Prompt] Agent wants to execute tool "${pc.bold(toolName)}" with arguments:`));
  console.log(pc.dim(JSON.stringify(args, null, 2)));
  
  let approved = false;
  try {
    const answer = await activeRl.question(pc.cyan(`Do you want to allow this tool call? (y/n) [y] (using "Y" and "N" is permanent) › `));
    const trimmed = answer.trim();
    const normalized = trimmed.toLowerCase();
    approved = normalized === '' || normalized === 'y' || normalized === 'yes';
    
    // If the response contains any uppercase character, make the decision permanent for this session
    if (/[A-Z]/.test(trimmed)) {
      const policyValue = approved ? 'allow' : 'deny';
      toolPolicies[toolName] = policyValue;
      console.log(pc.green(`✔ Policy for "${pc.bold(toolName)}" set to ${pc.bold(policyValue.toUpperCase())} permanently for this session.\n`));
    }
  } catch (err) {
    approved = false;
  } finally {
    // Restore raw mode
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(oldRawMode || false);
    }
  }
  
  if (!approved) {
    console.log(pc.red(`🚫 [Policy Prompt] Tool "${toolName}" execution declined by user.`));
  }
  return approved;
}

// Wrapper function to add CLI printing, logging and error capturing around any FunctionTool
export function wrapFunctionTool(toolObj) {
  return new FunctionTool({
    name: toolObj.name,
    description: toolObj.description,
    parameters: toolObj.parameters,
    execute: async (args, context) => {
      const allowed = await checkToolPermission(toolObj.name, args);
      if (!allowed) {
        const errorResult = { success: false, error: `Tool execution denied: User policy blocks "${toolObj.name}"` };
        printToolResult(toolObj.name, errorResult);
        return errorResult;
      }
      
      printToolCall(toolObj.name, args);
      try {
        const result = await toolObj.execute(args, context);
        printToolResult(toolObj.name, result);
        return result;
      } catch (error) {
        const errorResult = { success: false, error: error.message };
        printToolResult(toolObj.name, errorResult);
        return errorResult;
      }
    }
  });
}
