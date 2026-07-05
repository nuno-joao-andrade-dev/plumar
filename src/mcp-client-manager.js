import { spawn } from 'child_process';
import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import { FunctionTool } from '@google/adk';
import { printToolCall, printToolResult } from './formatter.js';

class McpClient {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.process = null;
    this.requestId = 1;
    this.pendingRequests = new Map();
    this.tools = [];
  }

  async start() {
    const { command, args = [], env = {} } = this.config;
    const spawnEnv = { ...process.env, ...env };

    this.process = spawn(command, args, { env: spawnEnv });

    this.process.on('error', (err) => {
      process.stderr.write(`⚠️  [MCP Client ${this.name}] Failed to spawn process: ${err.message}\n`);
    });

    this.process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`⚠️  [MCP Client ${this.name}] Process exited with code ${code}\n`);
      }
    });

    this.process.stderr.on('data', (data) => {
      // Forward stderr logging to terminal stderr
      process.stderr.write(`[MCP Log - ${this.name}] ${data.toString()}`);
    });

    const rl = readline.createInterface({
      input: this.process.stdout,
      terminal: false,
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const response = JSON.parse(line);
        const { id, result, error } = response;
        if (id !== undefined && this.pendingRequests.has(id)) {
          const { resolve, reject } = this.pendingRequests.get(id);
          this.pendingRequests.delete(id);
          if (error) {
            reject(new Error(error.message || JSON.stringify(error)));
          } else {
            resolve(result);
          }
        }
      } catch (err) {
        process.stderr.write(`⚠️  [MCP Client ${this.name}] Parse error: ${err.message}\n`);
      }
    });

    // Step 1: Initialize handshake
    try {
      await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'plumar-cli', version: '1.0.0' }
      }, 5000);

      this.sendNotification('notifications/initialized');

      // Step 2: Query tools list
      const toolsResult = await this.sendRequest('tools/list', {}, 5000);
      this.tools = toolsResult.tools || [];
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  sendRequest(method, params, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        return reject(new Error(`MCP Server ${this.name} is not running.`));
      }
      const id = this.requestId++;
      
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request "${method}" to server "${this.name}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      
      try {
        const payload = { jsonrpc: '2.0', id, method, params };
        this.process.stdin.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to write to MCP Server "${this.name}" stdin: ${err.message}`));
      }
    });
  }

  sendNotification(method, params) {
    if (!this.process || this.process.killed) return;
    try {
      const payload = { jsonrpc: '2.0', method, params };
      this.process.stdin.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      process.stderr.write(`⚠️  [MCP Client ${this.name}] Failed to send notification "${method}": ${err.message}\n`);
    }
  }

  async callTool(toolName, args) {
    return await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    }, 30000);
  }

  stop() {
    if (this.process) {
      // Clear all pending request timers to avoid keeping Node.js event loop alive
      for (const [id, req] of this.pendingRequests.entries()) {
        req.reject(new Error(`MCP Server ${this.name} stopped.`));
      }
      this.pendingRequests.clear();
      this.process.kill();
      this.process = null;
    }
  }
}

const activeClients = [];
const mcpTools = {};

/**
 * Loads external MCP servers from configuration and connects to them
 */
export async function loadAndStartMcpServers() {
  const configPath = path.resolve(process.cwd(), 'mcp-servers.json');
  
  try {
    const stat = await fs.stat(configPath);
    if (!stat.isFile()) return;
  } catch {
    // Config doesn't exist, skip gracefully
    return;
  }

  const content = await fs.readFile(configPath, 'utf-8');
  let config;
  try {
    config = JSON.parse(content);
  } catch (err) {
    process.stderr.write(`⚠️  Failed to parse mcp-servers.json: ${err.message}\n`);
    return;
  }

  const servers = config.mcpServers || {};
  const loadPromises = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (serverConfig.disabled) {
      continue;
    }

    process.stderr.write(`🔌 Connecting to MCP Server "${serverName}"...\n`);
    
    const client = new McpClient(serverName, serverConfig);
    const startPromise = client.start()
      .then(() => {
        activeClients.push(client);
        
        // Register each of its tools in our schema-validated tools dictionary
        for (const mcpTool of client.tools) {
          const uniqueToolName = `${serverName}_${mcpTool.name}`;
          
          mcpTools[uniqueToolName] = new FunctionTool({
            name: uniqueToolName,
            description: `[MCP Server: ${serverName}] ${mcpTool.description}`,
            parameters: mcpTool.inputSchema,
            execute: async (args) => {
              // Note: printToolCall and printToolResult are called inside agent.js execute wrapper,
              // but since MCP tools bypass agent.js rawTools mapping, we can print here or wrap it.
              // To match local tools, let's let agent.js wrap them!
              // Wait, in index.js we dynamically copy mcpTools into agent.js's tools, so agent.js's wrapper WILL run it!
              // This is perfect! So we just return the raw result here.
              const response = await client.callTool(mcpTool.name, args);
              if (response.isError) {
                return {
                  success: false,
                  error: response.content?.[0]?.text || JSON.stringify(response),
                };
              }
              // Standard MCP returns an array of content blocks.
              // To ensure compatibility with standard tools, flatten the text content blocks.
              const texts = (response.content || [])
                .filter(c => c.type === 'text')
                .map(c => c.text);

              if (texts.length > 0) {
                const rawText = texts.join('\n\n');
                let formattedContent = '';
                try {
                  // Attempt to parse if it is serialized JSON (typical for our search MCP)
                  const parsed = JSON.parse(rawText);
                  if (Array.isArray(parsed)) {
                    formattedContent = parsed.map((item, index) => {
                      let str = `${index + 1}.`;
                      if (item.title) str += ` **${item.title.trim()}**`;
                      if (item.url) str += `\n   URL: ${item.url.trim()}`;
                      if (item.snippet) str += `\n   Snippet: ${item.snippet.trim()}`;
                      return str;
                    }).join('\n\n');
                  } else if (typeof parsed === 'object' && parsed !== null) {
                    formattedContent = Object.entries(parsed)
                      .map(([k, v]) => `**${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                      .join('\n');
                  } else {
                    formattedContent = rawText;
                  }
                } catch {
                  // Fall back to raw text if not JSON
                  formattedContent = rawText;
                }

                return {
                  success: true,
                  content: formattedContent,
                };
              }

              return {
                success: true,
                content: JSON.stringify(response.content),
              };
            }
          });
        }
        process.stderr.write(`✔ Connected to MCP Server "${serverName}". Registered ${client.tools.length} tools.\n`);
      })
      .catch((err) => {
        process.stderr.write(`❌ Connection to MCP Server "${serverName}" failed: ${err.message}\n`);
      });

    loadPromises.push(startPromise);
  }

  await Promise.all(loadPromises);
}

/**
 * Returns registered MCP tools
 */
export function getMcpTools() {
  return mcpTools;
}

/**
 * Cleanup all active subprocesses on exit
 */
export function shutdownMcpClients() {
  for (const client of activeClients) {
    client.stop();
  }
}

// Ensure cleanup on sudden process termination
process.on('exit', shutdownMcpClients);
process.on('SIGINT', shutdownMcpClients);
process.on('SIGTERM', shutdownMcpClients);
