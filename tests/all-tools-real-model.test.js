import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tools } from '../src/tools.js';
import { fetchOllamaModels, runAgentTurn, setDefaultPolicy } from '../src/agent.js';

test('Unified Multi-Tool and Real-Model Integration Suite', async (t) => {
  // Ensure we can run all tools without policy prompt blocks
  t.beforeEach(() => {
    setDefaultPolicy('allow');
  });

  await t.test('LLM Discovery & First Model Turn Execution', async () => {
    try {
      const models = await fetchOllamaModels();
      console.log('Available models:', models);
      if (models && models.length > 0) {
        const firstModel = models[0];
        console.log(`Executing real model turn using first available model: ${firstModel}`);
        
        // Execute a real conversational turn
        const result = await runAgentTurn(
          'integration-test-session',
          'Hello, please reply with a one-word greeting.',
          firstModel,
          'balanced'
        );
        
        console.log(`Model response text: "${result.text}"`);
        assert.ok(result);
        assert.ok(typeof result.text === 'string');
      } else {
        console.log('No models found, skipping real model turn execution.');
      }
    } catch (err) {
      console.log('Ollama is offline or unreachable during discovery test, skipping real-model turn.', err.message);
    }
  });

  // --- 1. Filesystem Tools ---
  await t.test('Filesystem Tools Suite', async (t) => {
    const tempFile = 'scratch/test_fs_integration.txt';
    const tempMd = 'scratch/test_fs_integration.md';
    const tempDir = 'scratch/test_fs_dir';

    // Ensure scratch directory exists
    await fs.mkdir('scratch', { recursive: true }).catch(() => {});

    await t.test('writeFile & readFile: should write and read text files', async () => {
      const writeRes = await tools.writeFile.execute({ filePath: tempFile, content: 'Plumar unified tools integration' });
      assert.strictEqual(writeRes.success, true);

      const readRes = await tools.readFile.execute({ filePath: tempFile });
      assert.strictEqual(readRes.success, true);
      assert.match(readRes.content, /Plumar unified tools/);
    });

    await t.test('appendFile: should append contents to file', async () => {
      const appendRes = await tools.appendFile.execute({ filePath: tempFile, content: '\nAppended Line' });
      assert.strictEqual(appendRes.success, true);

      const readRes = await tools.readFile.execute({ filePath: tempFile });
      assert.match(readRes.content, /Appended Line/);
    });

    await t.test('listFiles: should recursively list workspace files', async () => {
      const listRes = await tools.listFiles.execute({ directory: '.' });
      assert.strictEqual(listRes.success, true);
      assert.ok(Array.isArray(listRes.files));
      assert.ok(listRes.files.some(f => f.name.includes('package.json')));
    });

    await t.test('findFiles: should scan and find matching files', async () => {
      const findRes = await tools.findFiles.execute({ pattern: 'package.json', directory: '.' });
      assert.strictEqual(findRes.success, true);
      assert.ok(findRes.matches.length >= 1);
    });

    await t.test('searchGrep: should find exact text matches', async () => {
      const grepRes = await tools.searchGrep.execute({ query: 'Plumar unified tools', directory: '.' });
      assert.strictEqual(grepRes.success, true);
      assert.ok(grepRes.totalMatches >= 1);
    });

    await t.test('searchReplace: should replace substring inside file', async () => {
      const replaceRes = await tools.searchReplace.execute({
        filePath: tempFile,
        findText: 'Appended Line',
        replaceText: 'Replaced Line'
      });
      assert.strictEqual(replaceRes.success, true);

      const readRes = await tools.readFile.execute({ filePath: tempFile });
      assert.match(readRes.content, /Replaced Line/);
    });

    await t.test('writeMarkdown: should write formatted markdown files', async () => {
      const mdRes = await tools.writeMarkdown.execute({
        filePath: tempMd,
        title: 'Integration Test',
        sections: [{ heading: 'Overview', body: 'Testing markdown generation' }]
      });
      assert.strictEqual(mdRes.success, true);

      const content = await fs.readFile(tempMd, 'utf8');
      assert.match(content, /# Integration Test/);
      assert.match(content, /## Overview/);
    });

    await t.test('makeDirectory: should create directory structures', async () => {
      const mkdirRes = await tools.makeDirectory.execute({ directoryPath: tempDir });
      assert.strictEqual(mkdirRes.success, true);

      const stats = await fs.stat(tempDir);
      assert.ok(stats.isDirectory());
    });

    await t.test('executeCommand: should run simple command line commands', async () => {
      const cmdRes = await tools.executeCommand.execute({ command: 'echo "Execution Integration"' });
      assert.strictEqual(cmdRes.success, true);
      assert.match(cmdRes.stdout, /Execution Integration/);
    });

    await t.test('deleteFile: should clean up the created files', async () => {
      const del1 = await tools.deleteFile.execute({ filePath: tempFile });
      const del2 = await tools.deleteFile.execute({ filePath: tempMd });
      assert.strictEqual(del1.success, true);
      assert.strictEqual(del2.success, true);

      // Clean up directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });
  });

  // --- 2. Media Tools ---
  await t.test('Media Tools Suite', async (t) => {
    await t.test('createAsciiArt: should generate beautiful slanting ascii art', async () => {
      const res = await tools.createAsciiArt.execute({ text: 'PLUMAR', font: 'slant' });
      assert.strictEqual(res.success, true);
      assert.ok(res.art);
    });

    await t.test('fetchImage: should retrieve remote image successfully', async () => {
      const tempImg = 'scratch/temp_downloaded_test.jpeg';
      try {
        const res = await tools.fetchImage.execute({
          url: 'https://nja.dev/assets/img/avatar.jpeg',
          outputPath: tempImg
        });
        assert.strictEqual(res.success, true);
        assert.ok(res.sizeBytes > 0);
      } finally {
        await fs.unlink(tempImg).catch(() => {});
      }
    });

    await t.test('base64Convert: should perform encoding and decoding operations', async () => {
      const encodeRes = await tools.base64Convert.execute({ action: 'encode', input: 'Plumar Engine' });
      assert.strictEqual(encodeRes.success, true);
      assert.strictEqual(encodeRes.result, 'UGx1bWFyIEVuZ2luZQ==');

      const decodeRes = await tools.base64Convert.execute({ action: 'decode', input: 'UGx1bWFyIEVuZ2luZQ==' });
      assert.strictEqual(decodeRes.success, true);
      assert.strictEqual(decodeRes.result, 'Plumar Engine');
    });

    await t.test('generateImage: should return custom procedurally generated image offline', async () => {
      const tempGenImg = 'scratch/temp_proc_image.png';
      try {
        const res = await tools.generateImage.execute({
          outputPath: tempGenImg,
          prompt: 'a purple balloon floating in space'
        });
        assert.strictEqual(res.success, true);
        const stats = await fs.stat(tempGenImg);
        assert.ok(stats.size > 0);
      } finally {
        await fs.unlink(tempGenImg).catch(() => {});
      }
    });

    await t.test('generateVideo: should gracefully create a mock video file offline', async () => {
      const tempVideo = 'scratch/temp_proc_video.mp4';
      try {
        const res = await tools.generateVideo.execute({
          outputPath: tempVideo,
          prompt: 'cinematic drone shot of cliffs'
        });
        assert.strictEqual(res.success, true);
      } finally {
        await fs.unlink(tempVideo).catch(() => {});
      }
    });

    await t.test('ocrImage & readAndSendImage: should fail gracefully for non-existent files', async () => {
      const ocrRes = await tools.ocrImage.execute({ imagePath: 'scratch/non_existent_ocr.png' });
      assert.strictEqual(ocrRes.success, false);

      const describeRes = await tools.readAndSendImage.execute({
        imagePath: 'scratch/non_existent_ocr.png',
        prompt: 'what is this?'
      });
      assert.strictEqual(describeRes.success, false);
    });
  });

  // --- 3. System Tools ---
  await t.test('System Tools Suite', async (t) => {
    await t.test('calculator: should compute expressions correctly', async () => {
      const res = await tools.calculator.execute({ expression: '(100 - 45) / 5' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.result, 11);
    });

    await t.test('getSystemInfo & getCurrentTime: should retrieve live server diagnostic statistics', async () => {
      const info = await tools.getSystemInfo.execute({});
      assert.strictEqual(info.success, true);
      assert.ok(info.platform);

      const time = await tools.getCurrentTime.execute({});
      assert.strictEqual(time.success, true);
      assert.ok(time.localTime);
    });

    await t.test('dinoGame: should fetch browser dino server status successfully', async () => {
      const res = await tools.dinoGame.execute({ action: 'status' });
      assert.strictEqual(res.success, true);
      assert.ok(res.message);
    });

    await t.test('generateMockData: should construct customized mock data arrays', async () => {
      const res = await tools.generateMockData.execute({ format: 'json', schema: 'user', count: 3 });
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.data) || typeof res.data === 'string');
    });

    await t.test('generateHash: should calculate correct SHA256 hashes', async () => {
      const res = await tools.generateHash.execute({ action: 'sha256', input: 'plumar' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.hash, 'df55c9f892be68dc7f4f16e3ec11d1a67174527d4f2291252966f753acd8fd9e');
    });
  });

  // --- 4. Web Tools ---
  await t.test('Web Tools Suite', async (t) => {
    await t.test('fetchWebPage: should download public web document', async () => {
      const res = await tools.fetchWebPage.execute({ url: 'https://jsonplaceholder.typicode.com/todos/1' });
      assert.strictEqual(res.success, true);
      assert.match(res.content, /"id": 1/);
    });

    await t.test('restClient: should perform successful REST API requests', async () => {
      const res = await tools.restClient.execute({ url: 'https://jsonplaceholder.typicode.com/todos/1', method: 'GET' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 200);
    });

    await t.test('apiPerformanceTest: should run concurrent speed benchmarking tests', async () => {
      const res = await tools.apiPerformanceTest.execute({
        url: 'https://jsonplaceholder.typicode.com/todos/1',
        requests: 2,
        concurrency: 1
      });
      assert.strictEqual(res.success, true);
      assert.ok(res.summary.totalRequests >= 1);
    });
  });

  // --- 5. Agent Skills & Plugins Tools ---
  await t.test('Agent Skills and Plugins Suite', async (t) => {
    const tempSkillName = 'integration_test_skill';
    const tempPluginFile = 'integration_test_plugin.js';

    await t.test('listSkills: should list currently loaded system skills', async () => {
      const res = await tools.listSkills.execute({});
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.skills));
    });

    await t.test('createSkill: should construct new custom skills', async () => {
      const res = await tools.createSkill.execute({
        name: tempSkillName,
        description: 'Temporary skill for automated integration testing',
        tags: ['test', 'integration'],
        instructions: '# Dynamic Instruction Set\nTest skill'
      });
      assert.strictEqual(res.success, true);
    });

    await t.test('loadSkill: should load and read customized skill parameters', async () => {
      const res = await tools.loadSkill.execute({ name: tempSkillName });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.name, tempSkillName);
    });

    await t.test('createPlugin: should construct plugin module packages', async () => {
      const res = await tools.createPlugin.execute({
        fileName: tempPluginFile,
        codeContent: `
          export const testPluginTool = {
            name: 'testPluginTool',
            description: 'Test plugin tool description',
            execute: async () => {
              return { success: true, fromPlugin: true };
            }
          };
        `
      });
      assert.strictEqual(res.success, true);
    });

    // Clean up created skill & plugin files
    t.after(async () => {
      await fs.rm(path.join(process.cwd(), 'skills', tempSkillName), { recursive: true, force: true }).catch(() => {});
      await fs.unlink(path.join(process.cwd(), 'plugins', tempPluginFile)).catch(() => {});
    });
  });

  // --- 6. Development Tools ---
  await t.test('Advanced Developer Tools Suite', async (t) => {
    await t.test('portManager: should inspect custom port processes', async () => {
      const res = await tools.portManager.execute({ action: 'list', port: 19999 });
      assert.strictEqual(res.success, true);
    });

    await t.test('regexHelper: should validate, test and match regular expressions', async () => {
      const res = await tools.regexHelper.execute({
        action: 'test',
        pattern: '^Plumar',
        text: 'Plumar is an awesome CLI.'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.matched, true);
    });

    await t.test('codeFormatter: should format file source structures', async () => {
      const tempFormatFile = 'scratch/test_format_integration.js';
      await fs.writeFile(tempFormatFile, 'function test() {console.log("format");}');
      try {
        const res = await tools.codeFormatter.execute({ filePath: tempFormatFile, action: 'format' });
        assert.strictEqual(res.success, true);
      } finally {
        await fs.unlink(tempFormatFile).catch(() => {});
      }
    });

    await t.test('dependencyScanner: should scan workspace dependencies', async () => {
      const res = await tools.dependencyScanner.execute({ action: 'scanImports' });
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.declaredDependencies));
    });

    await t.test('gitHelper: should retrieve git repository log and status metadata', async () => {
      const res = await tools.gitHelper.execute({ action: 'status' });
      assert.strictEqual(res.success, true);
    });

    await t.test('dbExplorer: should return schema details or fail gracefully on offline PostgreSQL/MySQL databases', async () => {
      const res = await tools.dbExplorer.execute({
        connectionUri: 'postgres://user:pass@localhost:5432/dbname',
        action: 'schema'
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error, /PostgreSQL query execution failed/);
    });

    await t.test('codeFixer: should sequentially write and modify files safely', async () => {
      const tempFixFile = 'scratch/test_codefixer_integration.js';
      try {
        const writeRes = await tools.codeFixer.execute({
          filePath: tempFixFile,
          operations: [
            { action: 'write', content: 'const val = 10;\n' },
            { action: 'append', content: 'console.log(val);\n' }
          ],
          lintAndFormat: false
        });
        assert.strictEqual(writeRes.success, true);

        const content = await fs.readFile(tempFixFile, 'utf8');
        assert.match(content, /const val = 10;/);
        assert.match(content, /console.log\(val\);/);
      } finally {
        await fs.unlink(tempFixFile).catch(() => {});
      }
    });
  });
});
