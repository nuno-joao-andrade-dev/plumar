import test from 'node:test';
import assert from 'node:assert/strict';
import { castParameter, runAgentTurn, Ollama, CHAT_MODES } from '../src/agent.js';

test('Ollama Parameters & Command Integration Suite', async (t) => {

  await t.test('castParameter function checks', () => {
    // 1. Float Casting
    assert.equal(castParameter('temperature', '0.85'), 0.85);
    assert.equal(castParameter('top_p', '0.99'), 0.99);
    assert.equal(castParameter('min_p', '0.05'), 0.05);
    assert.equal(castParameter('repeat_penalty', '1.25'), 1.25);
    assert.equal(castParameter('temperature', 'invalid'), null);

    // 2. Integer Casting
    assert.equal(castParameter('top_k', '50'), 50);
    assert.equal(castParameter('seed', '42'), 42);
    assert.equal(castParameter('num_ctx', '8192'), 8192);
    assert.equal(castParameter('num_predict', '256'), 256);
    assert.equal(castParameter('repeat_last_n', '64'), 64);
    assert.equal(castParameter('seed', 'invalid'), null);

    // 3. Array Casting (stop parameter)
    assert.deepEqual(castParameter('stop', 'User:,Assistant:'), ['User:', 'Assistant:']);
    assert.deepEqual(castParameter('stop', '["\\n", "User:"]'), ['\n', 'User:']);
    assert.deepEqual(castParameter('stop', ['\\n', 'User:']), ['\\n', 'User:']);
  });

  await t.test('Ollama Client payload generation with merged options', async () => {
    const customOptions = {
      temperature: 0.9,
      top_p: 0.95,
      seed: 1234,
      stop: ['\n', '###']
    };

    const client = new Ollama({
      model: 'gemma4:latest',
      sessionId: 'test-session-params',
      options: customOptions
    });

    assert.equal(client.model, 'gemma4:latest');
    assert.equal(client.sessionId, 'test-session-params');
    assert.deepEqual(client.options, customOptions);

    // Mock fetch and inspect payload generated inside generateContentAsync
    const originalFetch = globalThis.fetch;
    let capturedPayload = null;

    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/api/show')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model_info: {
              'gemma4.context_length': 4096
            }
          })
        };
      }
      if (url.endsWith('/api/chat')) {
        capturedPayload = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              role: 'assistant',
              content: 'Mocked response'
            },
            prompt_eval_count: 10,
            eval_count: 5
          })
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    try {
      const iterator = client.generateContentAsync({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        config: { temperature: 0.7 }
      });
      const result = await iterator.next();
      assert.ok(!result.done);
      assert.equal(result.value.content.parts[0].text, 'Mocked response');

      // Verify options are merged correctly inside payload.options
      assert.ok(capturedPayload);
      assert.equal(capturedPayload.options.num_ctx, 4096);
      assert.equal(capturedPayload.options.num_predict, -1);
      assert.equal(capturedPayload.options.temperature, 0.9);
      assert.equal(capturedPayload.options.top_p, 0.95);
      assert.equal(capturedPayload.options.seed, 1234);
      assert.deepEqual(capturedPayload.options.stop, ['\n', '###']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('runAgentTurn should merge mode and dynamic session overrides', async () => {
    const originalOllama = Ollama;
    let capturedConstructorOptions = null;

    // Temporarily mock the Ollama class to capture the constructor arguments
    class MockOllama extends Ollama {
      constructor(args) {
        super(args);
        capturedConstructorOptions = args.options;
      }
      async *generateContentAsync(llmRequest, stream, abortSignal) {
        yield {
          content: {
            role: 'model',
            parts: [{ text: 'Mock response text' }]
          }
        };
      }
    }

    // Apply mock
    Ollama.prototype.constructor = MockOllama;

    try {
      // 1. Run turn with mode defaults
      const originalBalancedMode = CHAT_MODES.balanced;
      CHAT_MODES.balanced = {
        ...originalBalancedMode,
        temperature: 0.7,
        top_p: 0.9,
        num_ctx: 2048
      };

      const sessionOverrides = {
        temperature: 0.4, // overrides mode 0.7
        seed: 777         // completely new session parameter
      };

      // We instantiate MockOllama internally within runAgentTurn
      // Wait, since we can't easily mock imports in running modules directly, let's test runAgentTurn's dynamic passing of customParameters.
      // But we can check if runAgentTurn passes them if we call it!
      // To inspect it, we can temporarily monkey-patch Ollama class inside agent.js by replacing the import, or just running runAgentTurn and letting our mocked fetch capture it.
      // Let's do a mocked fetch check inside runAgentTurn!
      const originalFetch = globalThis.fetch;
      let capturedPayload = null;

      globalThis.fetch = async (url, options) => {
        if (url.endsWith('/api/show')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              model_info: {
                'gemma4.context_length': 8192
              }
            })
          };
        }
        if (url.endsWith('/api/chat')) {
          capturedPayload = JSON.parse(options.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              message: {
                role: 'assistant',
                content: 'Response with custom params'
              },
              prompt_eval_count: 5,
              eval_count: 5
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      try {
        const res = await runAgentTurn(
          'test-run-params-session',
          'say hi',
          'gemma4:latest',
          'balanced',
          null, // abortSignal
          null, // customTemperature
          sessionOverrides // customParameters
        );

        assert.ok(res.text.includes('Response with custom params'));
        assert.ok(capturedPayload);
        assert.equal(capturedPayload.options.num_ctx, 2048); // from mode default
        assert.equal(capturedPayload.options.temperature, 0.4); // session override
        assert.equal(capturedPayload.options.top_p, 0.9); // from mode default
        assert.equal(capturedPayload.options.seed, 777); // session override
      } finally {
        globalThis.fetch = originalFetch;
        CHAT_MODES.balanced = originalBalancedMode;
      }
    } finally {
      Ollama.prototype.constructor = originalOllama;
    }
  });

  await t.test('Ollama Client fallback retry when tools are unsupported', async () => {
    const client = new Ollama({
      model: 'custom-no-tools:latest',
      sessionId: 'test-session-fallback'
    });

    const originalFetch = globalThis.fetch;
    let chatCallCount = 0;
    let capturedPayloads = [];

    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/api/show')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model_info: {
              'custom-no-tools.context_length': 2048
            }
          })
        };
      }
      if (url.endsWith('/api/chat')) {
        chatCallCount++;
        const payload = JSON.parse(options.body);
        capturedPayloads.push(payload);

        if (chatCallCount === 1) {
          // Simulate the first call failing because tools are passed
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => 'registry.ollama.ai/library/custom-no-tools:latest does not support tools'
          };
        }

        // Second call (retry) should succeed without tools
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              role: 'assistant',
              content: 'Successfully responded in text-only mode.'
            },
            prompt_eval_count: 12,
            eval_count: 8
          })
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    try {
      const iterator = client.generateContentAsync({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        config: { 
          tools: [{
            functionDeclarations: [{
              name: 'dummy_tool',
              description: 'a dummy tool'
            }]
          }]
        }
      });
      const result = await iterator.next();
      assert.ok(!result.done);
      assert.equal(result.value.content.parts[0].text, 'Successfully responded in text-only mode.');

      // Verify fetch was called exactly twice for chat
      assert.equal(chatCallCount, 2);

      // First payload should have had tools
      assert.ok(capturedPayloads[0].tools);
      assert.equal(capturedPayloads[0].tools[0].function.name, 'dummy_tool');

      // Second payload (retry) should NOT have tools
      assert.equal(capturedPayloads[1].tools, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('Ollama Client proactive tool bypass for gemma2', async () => {
    const client = new Ollama({
      model: 'gemma2:9b',
      sessionId: 'test-session-gemma2'
    });

    const originalFetch = globalThis.fetch;
    let chatCallCount = 0;
    let capturedPayloads = [];

    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/api/show')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            details: {
              family: 'gemma2'
            },
            model_info: {
              'general.architecture': 'gemma2',
              'gemma2.context_length': 2048
            }
          })
        };
      }
      if (url.endsWith('/api/chat')) {
        chatCallCount++;
        const payload = JSON.parse(options.body);
        capturedPayloads.push(payload);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              role: 'assistant',
              content: 'Successfully bypassed tools proactively.'
            },
            prompt_eval_count: 10,
            eval_count: 5
          })
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    try {
      const iterator = client.generateContentAsync({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        config: { 
          tools: [{
            functionDeclarations: [{
              name: 'dummy_tool',
              description: 'a dummy tool'
            }]
          }]
        }
      });
      const result = await iterator.next();
      assert.ok(!result.done);
      assert.equal(result.value.content.parts[0].text, 'Successfully bypassed tools proactively.');

      // Verify chat fetch was called exactly once
      assert.equal(chatCallCount, 1);

      // Verify payload had NO tools parameter
      assert.equal(capturedPayloads[0].tools, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});
