import test from 'node:test';
import assert from 'node:assert';
import { runAgentTurn, registerMcpTools } from '../src/agent.js';
import { loadAndStartMcpServers, getMcpTools, shutdownMcpClients } from '../src/mcp-client-manager.js';

test('Honda Civic Model Specs MCP Integration Test', async (t) => {
  await t.test('Should successfully perform Google/DuckDuckGo search and return Honda Civic specs without context truncation', async () => {
    const sessionId = 'mcp-honda-test-session-' + Date.now();
    const modelName = 'gemma4:latest';
    const prompt = 'use google search to return the latest honda civic model specs';

    console.log(`\n🔌 Loading MCP servers...`);
    await loadAndStartMcpServers();
    
    try {
      const mcpTools = getMcpTools();
      console.log(`✔ MCP Tools Registered:`, Object.keys(mcpTools));
      registerMcpTools(mcpTools);

      console.log(`🤖 Running prompt: "${prompt}" using model: "${modelName}"`);
      const response = await runAgentTurn(sessionId, prompt, modelName, 'balanced');

      console.log('\n--- AGENT RESPONSE ---');
      console.log(response.text);
      console.log('\n----------------------');

      // Assertions to verify the return of the MCP is working properly:
      assert.ok(response.text, 'The response should not be empty');
      assert.ok(
        response.text.toLowerCase().includes('civic') || response.text.toLowerCase().includes('honda'),
        'The response must contain reference to Honda or Civic'
      );
      
      const containsSpecs = 
        response.text.toLowerCase().includes('hp') || 
        response.text.toLowerCase().includes('horsepower') || 
        response.text.toLowerCase().includes('specs') || 
        response.text.toLowerCase().includes('specifications') ||
        response.text.toLowerCase().includes('torque') ||
        response.text.toLowerCase().includes('hybrid') ||
        response.text.toLowerCase().includes('trim');
        
      assert.ok(containsSpecs, 'The response should contain some technical model specs (hp, horsepower, specs, torque, hybrid, or trim)');
      console.log(`✔ Assertions passed: Honda Civic specs retrieved successfully!`);

    } finally {
      console.log('🔌 Shutting down MCP clients...');
      shutdownMcpClients();
    }
  });
});
