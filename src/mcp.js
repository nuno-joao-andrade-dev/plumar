import readline from 'readline';
import { tools as rawTools } from './tools.js';

/**
 * Starts the Model Context Protocol (MCP) server listening on stdin/stdout
 */
export function runMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Redirect standard console.log to stderr so that JSON-RPC output on stdout is never corrupted
  const originalLog = console.log;
  console.log = (...args) => {
    process.stderr.write(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ') + '\n');
  };

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const request = JSON.parse(line);
      const response = await handleMcpRequest(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` }
      }) + '\n');
    }
  });

  process.stderr.write('🚀 Gemma CLI Agent MCP Server started on stdio\n');
}

/**
 * Handles incoming JSON-RPC requests for the Model Context Protocol
 */
async function handleMcpRequest(request) {
  const { jsonrpc, id, method, params } = request;

  // Notifications (no id) are safely ignored or logged
  if (id === undefined) {
    return null;
  }

  if (jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: expected jsonrpc "2.0"' }
    };
  }

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'plumar-cli-mcp',
              version: '1.0.0',
            }
          }
        };
      }

      case 'tools/list': {
        const toolsList = Object.entries(rawTools).map(([name, toolObj]) => {
          const schema = toolObj.parameters.toJSONSchema();
          // Remove top-level schema declarations from JSON Schema as MCP expects simple schema objects
          delete schema.$schema;
          
          return {
            name,
            description: toolObj.description,
            inputSchema: schema,
          };
        });

        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: toolsList,
          }
        };
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        const toolObj = rawTools[name];

        if (!toolObj) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: tool "${name}" does not exist` }
          };
        }

        try {
          // Perform manual Zod validation and default resolution
          const actualArgs = args ?? {};
          const parsed = toolObj.parameters.safeParse(actualArgs);
          
          if (!parsed.success) {
            const expectedKeys = Object.keys(toolObj.parameters.shape || {}).join(', ');
            const errorMsg = `Invalid arguments for tool "${name}". Expected schema properties: [${expectedKeys}]. Error details: ${parsed.error.message}`;
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: errorMsg }],
                isError: true,
              }
            };
          }

          const result = await toolObj.execute(parsed.data);
          const isError = result.success === false;
          
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
                }
              ],
              isError,
            }
          };
        } catch (execError) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Execution failed: ${execError.message}` }],
              isError: true,
            }
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: "${method}"` }
        };
      }
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: `Internal error: ${error.message}` }
    };
  }
}
