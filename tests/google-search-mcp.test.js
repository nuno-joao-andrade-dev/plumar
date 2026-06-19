import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import readline from 'readline';

test('Google Search MCP Server Handshake & Parsing Integration Test', async (t) => {
  await t.test('Should start up, respond to initialize, list tools, and execute a search query', async () => {
    const processInstance = spawn('node', ['src/google-search-mcp.js']);
    
    const rlInstance = readline.createInterface({
      input: processInstance.stdout,
      terminal: false
    });
    
    const writeToStdin = (obj) => {
      processInstance.stdin.write(JSON.stringify(obj) + '\n');
    };
    
    // 1. Initialize Request
    writeToStdin({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    });
    
    let initialized = false;
    let listedTools = false;
    let searchResult = null;
    
    for await (const line of rlInstance) {
      const response = JSON.parse(line);
      if (response.id === 1) {
        assert.strictEqual(response.jsonrpc, '2.0');
        assert.ok(response.result.serverInfo);
        assert.strictEqual(response.result.serverInfo.name, 'google-search-mcp');
        initialized = true;
        
        // 2. Tools List Request
        writeToStdin({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        });
      } else if (response.id === 2) {
        assert.strictEqual(response.jsonrpc, '2.0');
        assert.ok(Array.isArray(response.result.tools));
        const searchTool = response.result.tools.find(t => t.name === 'search');
        assert.ok(searchTool);
        assert.strictEqual(searchTool.name, 'search');
        listedTools = true;
        
        // 3. Tools Call Request
        writeToStdin({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {
              query: 'nodejs'
            }
          }
        });
      } else if (response.id === 3) {
        assert.strictEqual(response.jsonrpc, '2.0');
        assert.ok(response.result.content);
        searchResult = JSON.parse(response.result.content[0].text);
        assert.ok(Array.isArray(searchResult));
        
        processInstance.kill();
        break;
      }
    }
    
    assert.ok(initialized, 'Should have received initialization handshake');
    assert.ok(listedTools, 'Should have listed registered tools');
    assert.ok(searchResult && searchResult.length > 0, 'Should have successfully fetched and parsed web search results');
  });
});
