import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { tools } from '../src/tools.js';
import { Jimp } from 'jimp';
import { wrapFunctionTool, resetTurnToolHistory, setToolPolicy } from '../src/policy-manager.js';
import {
  detectAndParseTextToolCalls,
  extractThinkingProcessToolCalls,
  hasActionableThinkingPlan,
  adkContentsToOllamaMessages,
  stripRedundantToolSchemasFromPrompt,
  readStreamingResponse,
  compactMessagesForContextHeadroom,
  parseCommandsFromText,
  Ollama
} from '../src/ollama-client.js';
import { refeedThinkingProcess } from '../src/agent.js';
import { isExecuteThinkingEnabled, setExecuteThinkingEnabled } from '../src/agent-config.js';
import { resolveSafePath } from '../src/tools/core-helper.js';
import { stripTerminalQueryGarbage } from '../src/terminal-io.js';
import { createCliCompleter } from '../src/completer.js';
import { handleMcpRequest } from '../src/mcp.js';

test('1. calculator tool', async (t) => {
  await t.test('should evaluate simple math expression', async () => {
    const res = await tools.calculator.execute({ expression: '3 * (4 + 5) - 2' });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.result, 25);
  });

  await t.test('should handle modulo and decimals', async () => {
    const res = await tools.calculator.execute({ expression: '10 % 3 + 1.5' });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.result, 2.5);
  });

  await t.test('should block invalid characters (security check)', async () => {
    const res = await tools.calculator.execute({ expression: '2 + alert("hack")' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /forbidden characters/i);
  });

  await t.test('should capture syntax errors gracefully', async () => {
    const res = await tools.calculator.execute({ expression: '2 + (3 *' });
    assert.deepStrictEqual(res.success, false);
    assert.ok(res.error);
  });
});

test('2. getSystemInfo tool', async (t) => {
  await t.test('should return system stats', async () => {
    const res = await tools.getSystemInfo.execute({});
    assert.deepStrictEqual(res.success, true);
    assert.ok(res.platform);
    assert.ok(res.release);
    assert.ok(res.arch);
    assert.ok(typeof res.uptimeHours === 'number');
    assert.ok(res.memory.totalGB > 0);
    assert.ok(res.memory.percentUsed >= 0);
    assert.ok(res.cpu.cores > 0);
  });
});

test('3. getCurrentTime tool', async (t) => {
  await t.test('should return current system time values', async () => {
    const res = await tools.getCurrentTime.execute({});
    assert.deepStrictEqual(res.success, true);
    assert.ok(res.localTime);
    assert.ok(res.isoString);
    assert.ok(res.timestamp > 0);
  });
});

test('4. listFiles tool', async (t) => {
  await t.test('should list workspace files', async () => {
    const res = await tools.listFiles.execute({ directory: '.' });
    assert.deepStrictEqual(res.success, true);
    assert.ok(Array.isArray(res.files));
    // Verify some standard project files exist in list
    const fileNames = res.files.map(f => f.name);
    assert.ok(fileNames.includes('package.json'));
    assert.ok(fileNames.includes('src/tools.js'));
  });
});

test('5. Filesystem Read/Write/Append/Delete tools', async (t) => {
  const tempFile = 'test_integration_temp.txt';
  const tempSubFile = 'test_sub_dir/inner.txt';

  // Cleanup before start
  try { await fs.unlink(tempFile); } catch {}
  try { await fs.rm('test_sub_dir', { recursive: true, force: true }); } catch {}

  await t.test('writeFile: should write a text file', async () => {
    const res = await tools.writeFile.execute({
      filePath: tempFile,
      content: 'Hello World from test!'
    });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.filePath, tempFile);
    assert.ok(res.sizeBytes > 0);

    const actual = await fs.readFile(tempFile, 'utf-8');
    assert.deepStrictEqual(actual, 'Hello World from test!');
  });

  await t.test('readFile: should read the created file', async () => {
    const res = await tools.readFile.execute({ filePath: tempFile });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.filePath, tempFile);
    assert.match(res.content, /Hello World/);
    assert.deepStrictEqual(res.isTruncated, false);
  });

  await t.test('appendFile: should append contents', async () => {
    const res = await tools.appendFile.execute({
      filePath: tempFile,
      content: '\nAppended contents!'
    });
    assert.deepStrictEqual(res.success, true);

    const actual = await fs.readFile(tempFile, 'utf-8');
    assert.deepStrictEqual(actual, 'Hello World from test!\nAppended contents!');
  });

  await t.test('readFile: non-existent file should fail gracefully', async () => {
    const res = await tools.readFile.execute({ filePath: 'missing_non_existent.txt' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /ENOENT/i);
  });

  await t.test('deleteFile: should delete the created file', async () => {
    const res = await tools.deleteFile.execute({ filePath: tempFile });
    assert.deepStrictEqual(res.success, true);

    const fileExists = await fs.access(tempFile).then(() => true).catch(() => false);
    assert.deepStrictEqual(fileExists, false);
  });

  await t.test('writeFile: should implicitly make directories', async () => {
    const res = await tools.writeFile.execute({
      filePath: tempSubFile,
      content: 'Nested file text'
    });
    assert.deepStrictEqual(res.success, true);

    const actual = await fs.readFile(tempSubFile, 'utf-8');
    assert.deepStrictEqual(actual, 'Nested file text');

    // Clean up
    await fs.rm('test_sub_dir', { recursive: true, force: true });
  });
});

test('6. Sandbox protection checks', async (t) => {
  await t.test('should block absolute path-traversal in readFile', async () => {
    const res = await tools.readFile.execute({ filePath: '/etc/passwd' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /Access denied/i);
  });

  await t.test('should block relative path-traversal in writeFile', async () => {
    const res = await tools.writeFile.execute({
      filePath: '../../traversal.txt',
      content: 'blocked'
    });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /Access denied/i);
  });

  await t.test('should block traversal in deleteFile', async () => {
    const res = await tools.deleteFile.execute({ filePath: '../../secret.txt' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /Access denied/i);
  });
});

test('7. makeDirectory tool', async (t) => {
  const testDir = 'test_explicit_dir/sub';

  await t.test('should create nested directories', async () => {
    const res = await tools.makeDirectory.execute({ directoryPath: testDir });
    assert.deepStrictEqual(res.success, true);

    const stats = await fs.stat(testDir);
    assert.ok(stats.isDirectory());

    // Clean up
    await fs.rm('test_explicit_dir', { recursive: true, force: true });
  });

  await t.test('should fail when directory path points outside workspace', async () => {
    const res = await tools.makeDirectory.execute({ directoryPath: '../outside_dir' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /Access denied/i);
  });
});

test('8. searchGrep tool', async (t) => {
  const tempSearchFile = 'test_grep_data.txt';
  const content = `Line 1: apple banana\nLine 2: cherry pineapple\nLine 3: grape fruit\n`;

  await fs.writeFile(tempSearchFile, content, 'utf-8');

  await t.test('should find text query in files', async () => {
    const res = await tools.searchGrep.execute({
      query: 'pineapple',
      directory: '.'
    });
    assert.deepStrictEqual(res.success, true);
    assert.ok(res.totalMatches >= 1);
    
    const match = res.matches.find(m => m.filePath === tempSearchFile);
    assert.ok(match);
    assert.deepStrictEqual(match.lineNumber, 2);
    assert.match(match.lineContent, /cherry pineapple/);
  });

  await t.test('should support regex query', async () => {
    const res = await tools.searchGrep.execute({
      query: '^Line\\s\\d:\\s[a-z]+',
      directory: '.',
      isRegex: true
    });
    assert.deepStrictEqual(res.success, true);
    const myMatches = res.matches.filter(m => m.filePath === tempSearchFile);
    assert.deepStrictEqual(myMatches.length, 3);
  });

  // Clean up
  await fs.unlink(tempSearchFile);
});

test('9. writeMarkdown tool', async (t) => {
  const mdFile = 'test_spec_output'; // purposefully omitting extension

  await t.test('should generate structured markdown and append .md extension', async () => {
    const res = await tools.writeMarkdown.execute({
      filePath: mdFile,
      title: 'Auto Spec Document',
      sections: [
        { heading: 'Overview', content: 'This is the spec description.' },
        { heading: 'Architecture', content: 'Module layout details.' }
      ]
    });

    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.filePath, 'test_spec_output.md');

    const content = await fs.readFile('test_spec_output.md', 'utf-8');
    assert.match(content, /# Auto Spec Document/);
    assert.match(content, /## Overview\n\nThis is the spec description\./);
    assert.match(content, /## Architecture\n\nModule layout details\./);

    // Clean up
    await fs.unlink('test_spec_output.md');
  });
});

test('10. fetchWebPage tool', async (t) => {
  await t.test('should fetch and parse JSON API endpoint', async () => {
    const res = await tools.fetchWebPage.execute({
      url: 'https://jsonplaceholder.typicode.com/todos/1'
    });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.status, 200);
    assert.match(res.contentType, /application\/json/);
    assert.match(res.content, /"id": 1/);
    assert.match(res.content, /"title":/);
  });

  await t.test('should fail gracefully for invalid URL', async () => {
    const res = await tools.fetchWebPage.execute({
      url: 'https://invalid-domain-that-does-not-exist-12345.com'
    });
    assert.deepStrictEqual(res.success, false);
    assert.ok(res.error);
  });
});

test('11. Robust Parameter Fallbacks and Safe Path Hardening', async (t) => {
  await t.test('writeFile should fallback to path parameter', async () => {
    const tempFile = 'test_fallback_writeFile.txt';
    try { await fs.unlink(tempFile); } catch {}

    const res = await tools.writeFile.execute({
      path: tempFile,
      content: 'Hello fallback'
    });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.filePath, tempFile);

    const actual = await fs.readFile(tempFile, 'utf-8');
    assert.deepStrictEqual(actual, 'Hello fallback');

    // Clean up
    await fs.unlink(tempFile);
  });

  await t.test('readFile should fallback to path parameter', async () => {
    const tempFile = 'test_fallback_readFile.txt';
    await fs.writeFile(tempFile, 'Sample content', 'utf-8');

    const res = await tools.readFile.execute({ path: tempFile });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.filePath, tempFile);
    assert.match(res.content, /Sample content/);

    // Clean up
    await fs.unlink(tempFile);
  });

  await t.test('makeDirectory should fallback to path or directory', async () => {
    const tempDir1 = 'test_fallback_dir1';
    const tempDir2 = 'test_fallback_dir2';
    try { await fs.rm(tempDir1, { recursive: true, force: true }); } catch {}
    try { await fs.rm(tempDir2, { recursive: true, force: true }); } catch {}

    // Using path
    const res1 = await tools.makeDirectory.execute({ path: tempDir1 });
    assert.deepStrictEqual(res1.success, true);
    assert.ok((await fs.stat(tempDir1)).isDirectory());

    // Using directory
    const res2 = await tools.makeDirectory.execute({ directory: tempDir2 });
    assert.deepStrictEqual(res2.success, true);
    assert.ok((await fs.stat(tempDir2)).isDirectory());

    // Clean up
    await fs.rm(tempDir1, { recursive: true, force: true });
    await fs.rm(tempDir2, { recursive: true, force: true });
  });

  await t.test('resolveSafePath should handle undefined or non-string paths gracefully', async () => {
    // 1. Missing parameter
    const res1 = await tools.readFile.execute({ filePath: undefined });
    assert.deepStrictEqual(res1.success, false);
    assert.match(res1.error, /Missing required parameter/i);

    // 2. Non-string parameter (triggers resolveSafePath type validation)
    const res2 = await tools.writeFile.execute({ path: 12345, content: 'test' });
    assert.deepStrictEqual(res2.success, false);
    assert.match(res2.error, /Access denied: Provided path must be a non-empty string/i);
  });

  await t.test('resolveSafePath strictly restricts access to current directory only', async () => {
    const res1 = await tools.readFile.execute({ filePath: '../outside.txt' });
    assert.deepStrictEqual(res1.success, false);
    assert.match(res1.error, /outside workspace directory/i);

    const res2 = await tools.writeFile.execute({ filePath: '/etc/passwd', content: 'hacked' });
    assert.deepStrictEqual(res2.success, false);
    assert.match(res2.error, /outside workspace directory/i);
  });
});

test('12. Project Folder & File Creation Workflows', async (t) => {
  const projectRoot = 'sample_project_src';

  // Ensure clean state before tests
  try { await fs.rm(projectRoot, { recursive: true, force: true }); } catch {}

  await t.test('makeDirectory should create a nested project folder structure', async () => {
    // Create controllers directory
    const res1 = await tools.makeDirectory.execute({ directoryPath: `${projectRoot}/controllers` });
    assert.deepStrictEqual(res1.success, true);
    assert.ok((await fs.stat(`${projectRoot}/controllers`)).isDirectory());

    // Create models directory
    const res2 = await tools.makeDirectory.execute({ directoryPath: `${projectRoot}/models` });
    assert.deepStrictEqual(res2.success, true);
    assert.ok((await fs.stat(`${projectRoot}/models`)).isDirectory());
  });

  await t.test('writeFile should successfully create files inside those project folders', async () => {
    // Write userController.js
    const controllerPath = `${projectRoot}/controllers/userController.js`;
    const controllerContent = 'export const getUsers = (req, res) => { res.json([]); };';
    const res1 = await tools.writeFile.execute({
      filePath: controllerPath,
      content: controllerContent
    });
    assert.deepStrictEqual(res1.success, true);
    assert.deepStrictEqual(res1.filePath, controllerPath);

    const actual1 = await fs.readFile(controllerPath, 'utf-8');
    assert.deepStrictEqual(actual1, controllerContent);

    // Write userModel.js
    const modelPath = `${projectRoot}/models/userModel.js`;
    const modelContent = 'export class User { constructor(name) { this.name = name; } }';
    const res2 = await tools.writeFile.execute({
      filePath: modelPath,
      content: modelContent
    });
    assert.deepStrictEqual(res2.success, true);

    const actual2 = await fs.readFile(modelPath, 'utf-8');
    assert.deepStrictEqual(actual2, modelContent);
  });

  await t.test('writeFile should implicitly create deeply nested subfolders during file creation', async () => {
    // Write deep nested file without creating folder first
    const deepFilePath = `${projectRoot}/views/admin/dashboard/index.html`;
    const htmlContent = '<h1>Admin Dashboard</h1>';
    
    const res = await tools.writeFile.execute({
      filePath: deepFilePath,
      content: htmlContent
    });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.filePath, deepFilePath);

    // Verify file and folders exist
    assert.ok((await fs.stat(`${projectRoot}/views/admin/dashboard`)).isDirectory());
    const actual = await fs.readFile(deepFilePath, 'utf-8');
    assert.deepStrictEqual(actual, htmlContent);
  });

  await t.test('listFiles should correctly return the created project files and subfolders', async () => {
    const res = await tools.listFiles.execute({ directory: projectRoot });
    assert.deepStrictEqual(res.success, true);
    assert.ok(Array.isArray(res.files));

    const fileNames = res.files.map(f => f.name);
    
    // Check files are correctly listed
    assert.ok(fileNames.includes('controllers/userController.js'));
    assert.ok(fileNames.includes('models/userModel.js'));
    assert.ok(fileNames.includes('views/admin/dashboard/index.html'));
  });

  // Clean up
  try { await fs.rm(projectRoot, { recursive: true, force: true }); } catch {}
});

test('13. Advanced File Handling Corner Cases', async (t) => {
  const tempCornerFile = 'test_corner_cases.txt';

  // Setup/Teardown logic inside the test context
  const cleanUp = async () => {
    try { await fs.unlink(tempCornerFile); } catch {}
  };

  await t.test('writeFile should handle empty strings and create an empty file', async () => {
    await cleanUp();
    const res = await tools.writeFile.execute({
      filePath: tempCornerFile,
      content: ''
    });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.sizeBytes, 0);

    const actual = await fs.readFile(tempCornerFile, 'utf-8');
    assert.deepStrictEqual(actual, '');
    await cleanUp();
  });

  await t.test('writeFile and readFile should preserve UTF-8 and special characters', async () => {
    await cleanUp();
    const unicodeContent = 'Hello, 世界! 🚀 Accents: áéíóú ñ, Emoji test: ✨🌟🔥';
    const resWrite = await tools.writeFile.execute({
      filePath: tempCornerFile,
      content: unicodeContent
    });
    assert.deepStrictEqual(resWrite.success, true);

    const resRead = await tools.readFile.execute({ filePath: tempCornerFile });
    assert.deepStrictEqual(resRead.success, true);
    assert.deepStrictEqual(resRead.content, unicodeContent);
    await cleanUp();
  });

  await t.test('appendFile should implicitly create a new file if it does not exist', async () => {
    await cleanUp();
    const res = await tools.appendFile.execute({
      filePath: tempCornerFile,
      content: 'Implicit creation via append'
    });
    assert.deepStrictEqual(res.success, true);

    const actual = await fs.readFile(tempCornerFile, 'utf-8');
    assert.deepStrictEqual(actual, 'Implicit creation via append');
    await cleanUp();
  });

  await t.test('writeFile should completely overwrite pre-existing files', async () => {
    await cleanUp();
    // Write initial
    await tools.writeFile.execute({ filePath: tempCornerFile, content: 'Initial Content' });
    
    // Overwrite
    const resOverwrite = await tools.writeFile.execute({ filePath: tempCornerFile, content: 'New' });
    assert.deepStrictEqual(resOverwrite.success, true);

    const actual = await fs.readFile(tempCornerFile, 'utf-8');
    assert.deepStrictEqual(actual, 'New');
    await cleanUp();
  });

  await t.test('readFile should truncate content exceeding 10,000 characters and append note', async () => {
    await cleanUp();
    const largeContent = 'A'.repeat(12000);
    await tools.writeFile.execute({ filePath: tempCornerFile, content: largeContent });

    const res = await tools.readFile.execute({ filePath: tempCornerFile });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.isTruncated, true);
    assert.strictEqual(res.content.length, 10000 + '\n[... TRUNCATED DUE TO SIZE LIMIT ...]'.length);
    assert.ok(res.content.endsWith('\n[... TRUNCATED DUE TO SIZE LIMIT ...]'));
    await cleanUp();
  });

  await t.test('deleteFile on non-existent file should return success false gracefully', async () => {
    await cleanUp();
    const res = await tools.deleteFile.execute({ filePath: 'never_existed_file_12345.txt' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /ENOENT/i);
  });
});

test('14. New Developer and Dino Game tools', async (t) => {
  await t.test('executeCommand: should run a simple echo command', async () => {
    const res = await tools.executeCommand.execute({ command: 'echo "hello from tests"' });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.exitCode, 0);
    assert.match(res.stdout, /hello from tests/);
  });

  await t.test('searchReplace: should replace substring inside a file', async () => {
    const tempFile = 'test_search_replace.txt';
    try { await fs.unlink(tempFile); } catch {}

    await fs.writeFile(tempFile, 'The quick brown fox jumps over the lazy dog', 'utf-8');
    const res = await tools.searchReplace.execute({
      filePath: tempFile,
      findText: 'brown fox',
      replaceText: 'glowing dinosaur'
    });

    assert.deepStrictEqual(res.success, true);
    const content = await fs.readFile(tempFile, 'utf-8');
    assert.deepStrictEqual(content, 'The quick glowing dinosaur jumps over the lazy dog');

    try { await fs.unlink(tempFile); } catch {}
  });

  await t.test('findFiles: should find files matching glob or substring', async () => {
    const res = await tools.findFiles.execute({ pattern: 'tools.test.js' });
    assert.deepStrictEqual(res.success, true);
    assert.ok(res.totalMatches >= 1);
    const hasMatch = res.matches.some(m => m.filePath.endsWith('tools.test.js'));
    assert.ok(hasMatch);
  });

  await t.test('dinoGame: should status and stop/start server', async () => {
    // Check initial status
    const statusRes = await tools.dinoGame.execute({ action: 'status' });
    assert.deepStrictEqual(statusRes.success, true);

    // Start game server
    const startRes = await tools.dinoGame.execute({ action: 'start' });
    assert.deepStrictEqual(startRes.success, true);
    assert.ok(startRes.url.startsWith('http://localhost:'));

    // Check status after start
    const statusRes2 = await tools.dinoGame.execute({ action: 'status' });
    assert.deepStrictEqual(statusRes2.success, true);
    assert.deepStrictEqual(statusRes2.running, true);

    // Stop game server
    const stopRes = await tools.dinoGame.execute({ action: 'stop' });
    assert.deepStrictEqual(stopRes.success, true);
  });

  await t.test('apiPerformanceTest: should perform load test on a dummy endpoint', async () => {
    const res = await tools.apiPerformanceTest.execute({
      url: 'https://jsonplaceholder.typicode.com/todos/1',
      requests: 5,
      concurrency: 2
    });
    assert.deepStrictEqual(res.success, true);
    assert.deepStrictEqual(res.summary.totalRequests, 5);
    assert.deepStrictEqual(res.summary.concurrency, 2);
    assert.ok(res.summary.requestsPerSecond >= 0);
    assert.ok(res.latencyMs.average >= 0);
  });

  await t.test('createAsciiArt: should generate ASCII art from text, shapes, and images', async () => {
    // Generate shape
    const shapeRes = await tools.createAsciiArt.execute({ presetShape: 'heart' });
    assert.deepStrictEqual(shapeRes.success, true);
    assert.match(shapeRes.art, /▄▄████▄▄/);

    // Generate block text
    const textBlockRes = await tools.createAsciiArt.execute({ text: 'HELLO', font: 'block' });
    assert.deepStrictEqual(textBlockRes.success, true);
    assert.match(textBlockRes.art, /▄███▄/);

    // Generate block text with actual and literal newlines
    const newlineRes = await tools.createAsciiArt.execute({ text: 'A\\nB\nC', font: 'block' });
    assert.deepStrictEqual(newlineRes.success, true);
    const blocks = newlineRes.art.split('\n\n');
    assert.deepStrictEqual(blocks.length, 3);

    // Generate slant text
    const textSlantRes = await tools.createAsciiArt.execute({ text: 'HELLO', font: 'slant' });
    assert.deepStrictEqual(textSlantRes.success, true);
    assert.match(textSlantRes.art, /▀▀▀▀/);

    // Generate image-to-ascii
    const testImageName = 'test_image_for_ascii.png';
    const testImagePath = path.join(process.cwd(), testImageName);
    try {
      // Create a small 10x10 white image
      const image = new Jimp({ width: 10, height: 10, color: 0xFFFFFFFF });
      await image.write(testImagePath);

      // Convert image to ASCII
      const imageAsciiRes = await tools.createAsciiArt.execute({
        imagePath: testImageName,
        imageWidth: 10
      });
      assert.deepStrictEqual(imageAsciiRes.success, true);
      // White image should map to light characters, e.g. @
      assert.match(imageAsciiRes.art, /@/);

      // Convert image to colored ASCII
      const imageAsciiResColored = await tools.createAsciiArt.execute({
        imagePath: testImageName,
        imageWidth: 10,
        colored: true
      });
      assert.deepStrictEqual(imageAsciiResColored.success, true);
      // Colored output should contain the ANSI escape code prefix for white/color
      assert.match(imageAsciiResColored.art, /\x1b\[38;2;/);

      // Convert image to colored ASCII and save to file
      const testOutputPath = 'test_ascii_output.txt';
      const imageAsciiResSaved = await tools.createAsciiArt.execute({
        imagePath: testImageName,
        imageWidth: 10,
        colored: true,
        outputPath: testOutputPath
      });
      assert.deepStrictEqual(imageAsciiResSaved.success, true);
      assert.match(imageAsciiResSaved.message, /Also saved to "test_ascii_output.txt"/);
      const savedContent = await fs.readFile(path.join(process.cwd(), testOutputPath), 'utf-8');
      assert.match(savedContent, /\x1b\[38;2;/);
      await fs.unlink(path.join(process.cwd(), testOutputPath));
    } finally {
      try {
        await fs.unlink(testImagePath);
      } catch {}
    }

    // Convert remote image URL to ASCII
    const remoteRes = await tools.createAsciiArt.execute({
      imagePath: 'https://nja.dev/assets/img/avatar.jpeg',
      imageWidth: 10
    });
    if (remoteRes.success) {
      assert.ok(remoteRes.art.length > 0);
    } else {
      assert.match(remoteRes.error, /fetch|network|dns|getaddrinfo/i);
    }

    // Convert remote image URL using "url" parameter directly
    const urlRes = await tools.createAsciiArt.execute({
      url: 'https://nja.dev/assets/img/avatar.jpeg',
      imageWidth: 10
    });
    if (urlRes.success) {
      assert.ok(urlRes.art.length > 0);
    } else {
      assert.match(urlRes.error, /fetch|network|dns|getaddrinfo/i);
    }

    // Error check
    const errorRes = await tools.createAsciiArt.execute({});
    assert.deepStrictEqual(errorRes.success, false);
    assert.match(errorRes.error, /You must provide/);
  });

  await t.test('fetchImage: should download remote image and save to disk', async () => {
    const tempFetchPath = 'temp_downloaded_avatar.jpeg';
    const resolvedTempPath = path.join(process.cwd(), tempFetchPath);
    try {
      const res = await tools.fetchImage.execute({
        url: 'https://nja.dev/assets/img/avatar.jpeg',
        outputPath: tempFetchPath
      });
      assert.deepStrictEqual(res.success, true);
      assert.deepStrictEqual(res.outputPath, tempFetchPath);
      assert.ok(res.sizeBytes > 0);
      assert.match(res.contentType, /image\//i);

      // Verify file actually written to disk
      const fileExists = await fs.access(resolvedTempPath).then(() => true).catch(() => false);
      assert.ok(fileExists);
    } finally {
      try {
        await fs.unlink(resolvedTempPath);
      } catch {}
    }
  });

  await t.test('base64Convert: should encode and decode strings and files', async () => {
    // String encode
    const encodeRes = await tools.base64Convert.execute({
      action: 'encode',
      input: 'Hello, World!'
    });
    assert.deepStrictEqual(encodeRes.success, true);
    assert.strictEqual(encodeRes.result, 'SGVsbG8sIFdvcmxkIQ==');

    // String decode
    const decodeRes = await tools.base64Convert.execute({
      action: 'decode',
      input: 'SGVsbG8sIFdvcmxkIQ=='
    });
    assert.deepStrictEqual(decodeRes.success, true);
    assert.strictEqual(decodeRes.result, 'Hello, World!');

    // File path encode/decode
    const tempTestFile = 'temp_b64_test.txt';
    const tempOutFile = 'temp_b64_out.txt';
    try {
      await fs.writeFile(tempTestFile, 'Base64 File Test content', 'utf-8');
      
      const fileEncode = await tools.base64Convert.execute({
        action: 'encode',
        inputType: 'file',
        input: tempTestFile,
        outputPath: tempOutFile
      });
      assert.deepStrictEqual(fileEncode.success, true);
      
      const encodedContent = await fs.readFile(tempOutFile, 'utf-8');
      assert.strictEqual(encodedContent, Buffer.from('Base64 File Test content').toString('base64'));
    } finally {
      try {
        await fs.unlink(tempTestFile);
      } catch {}
      try {
        await fs.unlink(tempOutFile);
      } catch {}
    }

    // Interception of invalid base64 image decoding (Self-healing test)
    const tempCakeFile = 'test_cake.jpg';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (typeof url === 'string' && url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'llama3' }] })
        };
      }
      if (typeof url === 'string' && url.includes('/api/chat')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              role: 'assistant',
              content: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
            }
          })
        };
      }
      if (typeof originalFetch === 'function') {
        return originalFetch(url, options);
      }
      throw new Error(`Unexpected fetch call in test: ${url}`);
    };

    try {
      const b64Res = await tools.base64Convert.execute({
        action: 'decode',
        input: '[Base64 data representing a birthday cake image]',
        outputPath: tempCakeFile
      });
      assert.deepStrictEqual(b64Res.success, true);
      assert.match(b64Res.message, /Successfully generated valid offline image/);
      
      const fileBytes = await fs.readFile(tempCakeFile);
      assert.ok(fileBytes.length > 2);
      // Verify it's a valid JPEG (starting with ffd8)
      assert.strictEqual(fileBytes[0], 0xff);
      assert.strictEqual(fileBytes[1], 0xd8);
    } finally {
      globalThis.fetch = originalFetch;
      try {
        await fs.unlink(tempCakeFile);
      } catch {}
    }
  });

  await t.test('generateMockData: should generate structured data in JSON, CSV, XML, YAML formats', async () => {
    // Generate JSON user data
    const jsonRes = await tools.generateMockData.execute({
      preset: 'users',
      format: 'json',
      count: 3
    });
    assert.deepStrictEqual(jsonRes.success, true);
    assert.strictEqual(jsonRes.preset, 'users');
    assert.strictEqual(jsonRes.format, 'json');
    assert.strictEqual(jsonRes.count, 3);
    const parsed = JSON.parse(jsonRes.data);
    assert.strictEqual(parsed.length, 3);
    assert.ok(parsed[0].name);

    // Generate CSV product data
    const csvRes = await tools.generateMockData.execute({
      preset: 'products',
      format: 'csv',
      count: 2
    });
    assert.deepStrictEqual(csvRes.success, true);
    assert.match(csvRes.data, /sku,name,category,price/i);

    // Generate custom preset
    const customRes = await tools.generateMockData.execute({
      preset: 'custom',
      format: 'yaml',
      count: 2,
      customFields: [
        { name: 'uid', type: 'uuid' },
        { name: 'fullName', type: 'name' },
        { name: 'cost', type: 'price' }
      ]
    });
    assert.deepStrictEqual(customRes.success, true);
    assert.match(customRes.data, /uid:/);
    assert.match(customRes.data, /fullName:/);
    assert.match(customRes.data, /cost:/);
  });

  await t.test('generateHash: should calculate correct cryptographic hash digests', async () => {
    // String SHA-256
    const hashRes = await tools.generateHash.execute({
      algorithm: 'sha256',
      input: 'test'
    });
    assert.deepStrictEqual(hashRes.success, true);
    // sha256 of "test" is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
    assert.strictEqual(hashRes.hash, '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');

    // String MD5
    const md5Res = await tools.generateHash.execute({
      algorithm: 'md5',
      input: 'test'
    });
    assert.deepStrictEqual(md5Res.success, true);
    // md5 of "test" is 098f6bcd4621d373cade4e832627b4f6
    assert.strictEqual(md5Res.hash, '098f6bcd4621d373cade4e832627b4f6');
  });
});

test('15. generateImage tool', async (t) => {
  await t.test('should procedurally generate a potato image file offline', async () => {
    const testPath = 'test_potato_generated.png';
    try {
      const res = await tools.generateImage.execute({
        outputPath: testPath,
        prompt: 'a small cute potato image',
        drawings: [
          { type: 'ellipse', x: 200, y: 200, rx: 120, ry: 80, color: '#8B5A2B' },
          { type: 'ellipse', x: 140, y: 180, rx: 6, ry: 4, color: '#5c3a1c' },
          { type: 'ellipse', x: 248, y: 220, rx: 5, ry: 5, color: '#5c3a1c' },
          { type: 'text', x: 150, y: 312, text: 'POTATO', scale: 3, color: '#ffffff' }
        ]
      });
      assert.deepStrictEqual(res.success, true);
      assert.deepStrictEqual(res.outputPath, testPath);

      // Verify file exists
      const fileExists = await fs.stat(testPath).then(() => true).catch(() => false);
      assert.ok(fileExists);

      // Read file with Jimp to verify it is a valid image
      const img = await Jimp.read(testPath);
      assert.strictEqual(img.bitmap.width, 400);
      assert.strictEqual(img.bitmap.height, 400);
    } finally {
      try {
        await fs.unlink(testPath);
      } catch {}
    }
  });

  await t.test('should support custom drawings array', async () => {
    const testPath = 'test_custom_generated.png';
    try {
      const res = await tools.generateImage.execute({
        outputPath: testPath,
        prompt: 'custom artwork',
        width: 100,
        height: 100,
        backgroundColor: '#00ff00',
        drawings: [
          { type: 'rect', x: 10, y: 10, width: 80, height: 80, color: '#ff0000' },
          { type: 'text', x: 20, y: 40, text: 'HI', scale: 2, color: '#ffffff' }
        ]
      });
      assert.deepStrictEqual(res.success, true);
      const img = await Jimp.read(testPath);
      assert.strictEqual(img.bitmap.width, 100);
      assert.strictEqual(img.bitmap.height, 100);
    } finally {
      try {
        await fs.unlink(testPath);
      } catch {}
    }
  });
});

test('16. generateVideo tool', async (t) => {
  await t.test('should gracefully generate a mock video file offline', async () => {
    const testPath = 'test_video_generated.mp4';
    try {
      const res = await tools.generateVideo.execute({
        outputPath: testPath,
        prompt: 'a futuristic city at sunset'
      });
      assert.deepStrictEqual(res.success, true);
      assert.deepStrictEqual(res.outputPath, testPath);

      // Verify file exists
      const fileExists = await fs.stat(testPath).then(() => true).catch(() => false);
      assert.ok(fileExists);

      // Read file content
      const content = await fs.readFile(testPath, 'utf-8');
      assert.ok(content.includes('MOCK_VIDEO_DATA_FOR_TESTS'));
    } finally {
      try {
        await fs.unlink(testPath);
      } catch {}
    }
  });
});

test('17. Advanced Developer Tools', async (t) => {
  await t.test('portManager: should list processes on an unused port', async () => {
    const res = await tools.portManager.execute({ action: 'list', port: 59381 });
    assert.deepStrictEqual(res.success, true);
    assert.ok(Array.isArray(res.processes));
    assert.strictEqual(res.processes.length, 0);
  });

  await t.test('portManager: should fail when killing with missing parameters', async () => {
    const res = await tools.portManager.execute({ action: 'kill' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /Either port or pid must be specified/);
  });

  await t.test('restClient: should fetch dynamic JSON data from API', async () => {
    const res = await tools.restClient.execute({ url: 'https://jsonplaceholder.typicode.com/todos/1' });
    assert.deepStrictEqual(res.success, true);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.id, 1);
  });

  await t.test('restClient: should fail gracefully on bad URLs', async () => {
    const res = await tools.restClient.execute({ url: 'invalid-url-format' });
    assert.deepStrictEqual(res.success, false);
    assert.ok(res.error);
  });

  await t.test('regexHelper: should test pattern matches correctly', async () => {
    const res = await tools.regexHelper.execute({
      action: 'test',
      pattern: 'hello',
      flags: 'i',
      text: 'Say Hello World'
    });
    assert.deepStrictEqual(res.success, true);
    assert.strictEqual(res.matched, true);
  });

  await t.test('regexHelper: should capture matched items', async () => {
    const res = await tools.regexHelper.execute({
      action: 'match',
      pattern: '\\d+',
      flags: 'g',
      text: 'Items 10 and 20'
    });
    assert.deepStrictEqual(res.success, true);
    assert.strictEqual(res.count, 2);
    assert.strictEqual(res.matches[0].match, '10');
    assert.strictEqual(res.matches[1].match, '20');
  });

  await t.test('regexHelper: should replace matched text', async () => {
    const res = await tools.regexHelper.execute({
      action: 'replace',
      pattern: 'apple',
      flags: 'g',
      text: 'an apple a day',
      replacement: 'orange'
    });
    assert.deepStrictEqual(res.success, true);
    assert.strictEqual(res.result, 'an orange a day');
  });

  await t.test('codeFormatter: should format or gracefully fallback for linting', async () => {
    const tempFormatFile = 'temp_format_test.js';
    try {
      await fs.writeFile(tempFormatFile, 'const x =  1;   \n', 'utf-8');
      const res = await tools.codeFormatter.execute({ filePath: tempFormatFile, action: 'format' });
      assert.deepStrictEqual(res.success, true);
    } finally {
      try { await fs.unlink(tempFormatFile); } catch {}
    }
  });

  await t.test('codeFormatter: should support formatting and linting for various language extensions with graceful fallbacks', async () => {
    const testCases = [
      { ext: '.py', content: 'def f():\n  pass\n' },
      { ext: '.go', content: 'package main\n' },
      { ext: '.rs', content: 'fn main() {}\n' },
      { ext: '.sh', content: '#!/bin/bash\n' },
      { ext: '.css', content: 'body { color: red; }\n' },
      { ext: '.sql', content: 'SELECT * FROM users;\n' },
      { ext: '.lua', content: 'print("hello")\n' },
    ];

    for (const tc of testCases) {
      const tempFile = `temp_format_test${tc.ext}`;
      try {
        await fs.writeFile(tempFile, tc.content, 'utf-8');
        
        // Test formatting
        const resFormat = await tools.codeFormatter.execute({ filePath: tempFile, action: 'format' });
        assert.deepStrictEqual(resFormat.success, true);
        
        // Test linting
        const resLint = await tools.codeFormatter.execute({ filePath: tempFile, action: 'lint' });
        assert.deepStrictEqual(resLint.success, true);
      } finally {
        try { await fs.unlink(tempFile); } catch {}
      }
    }
  });

  await t.test('dependencyScanner: should list project dependencies', async () => {
    const res = await tools.dependencyScanner.execute({ action: 'scanImports' });
    assert.deepStrictEqual(res.success, true);
    assert.ok(Array.isArray(res.declaredDependencies));
    assert.ok(Array.isArray(res.usedDependencies));
  });

  await t.test('gitHelper: should run status and log operations', async () => {
    const resStatus = await tools.gitHelper.execute({ action: 'status' });
    assert.deepStrictEqual(resStatus.success, true);

    const resLog = await tools.gitHelper.execute({ action: 'log' });
    assert.deepStrictEqual(resLog.success, true);

    const resDraft = await tools.gitHelper.execute({ action: 'draftCommitMessage' });
    assert.deepStrictEqual(resDraft.success, true);
    assert.ok(resDraft.draft || resDraft.message);
  });

  await t.test('dbExplorer: should fail gracefully for unsupported databases', async () => {
    const res = await tools.dbExplorer.execute({ connectionUri: 'sqlite://file.db', action: 'schema' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /Unsupported database protocol/);
  });

  await t.test('dbExplorer: should return schema details or fail gracefully on offline PostgreSQL/MySQL databases', async () => {
    const resPg = await tools.dbExplorer.execute({ connectionUri: 'postgres://user:pass@localhost:5432/dbname', action: 'schema' });
    // Since there is no live PostgreSQL instance running on this test runner, it should gracefully return success: false with the CLI command failure.
    assert.deepStrictEqual(resPg.success, false);
    assert.match(resPg.error, /PostgreSQL query execution failed/);

    const resMy = await tools.dbExplorer.execute({ connectionUri: 'mysql://user:pass@localhost:3306/dbname', action: 'schema' });
    assert.deepStrictEqual(resMy.success, false);
    assert.match(resMy.error, /MySQL query execution failed/);
  });
});

test('18. Multi-modal and OCR Tools', async (t) => {
  const originalFetch = globalThis.fetch;
  const testImagePath = 'test_ocr_sample.png';

  // Setup a dummy image file
  t.before(async () => {
    await fs.writeFile(testImagePath, 'fake image data');
  });

  t.after(async () => {
    try {
      await fs.unlink(testImagePath);
    } catch {}
  });

  await t.test('ocrImage: should successfully extract text from image using Ollama vision model', async () => {
    let fetchCalled = false;
    let payloadSent = null;

    globalThis.fetch = async (url, options) => {
      fetchCalled = true;
      payloadSent = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'CONFIDENTIAL\nDO NOT DISTRIBUTE'
          }
        })
      };
    };

    try {
      const res = await tools.ocrImage.execute({ imagePath: testImagePath });
      assert.deepStrictEqual(res.success, true);
      assert.strictEqual(res.message, 'OCR completed successfully.');
      assert.strictEqual(res.extractedText, 'CONFIDENTIAL\nDO NOT DISTRIBUTE');
      assert.ok(fetchCalled);
      assert.ok(payloadSent);
      assert.strictEqual(payloadSent.messages[0].images[0], Buffer.from('fake image data').toString('base64'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('ocrImage: should return graceful error if model does not support multimodal/image inputs', async () => {
    globalThis.fetch = async (url, options) => {
      return {
        ok: false,
        status: 400,
        text: async () => 'does not support multimodal/image inputs'
      };
    };

    try {
      const res = await tools.ocrImage.execute({ imagePath: testImagePath });
      assert.deepStrictEqual(res.success, false);
      assert.match(res.error, /does not support multimodal\/image inputs/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('ocrImage: should fail gracefully for non-existent image file', async () => {
    const res = await tools.ocrImage.execute({ imagePath: 'non_existent_file.png' });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /ENOENT/);
  });

  await t.test('readAndSendImage: should successfully analyze image with custom prompt', async () => {
    let fetchCalled = false;
    let payloadSent = null;

    globalThis.fetch = async (url, options) => {
      fetchCalled = true;
      payloadSent = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'This image contains text saying confidential.'
          }
        })
      };
    };

    try {
      const res = await tools.readAndSendImage.execute({
        imagePath: testImagePath,
        prompt: 'Describe this image'
      });
      assert.deepStrictEqual(res.success, true);
      assert.strictEqual(res.message, 'Image analyzed successfully.');
      assert.strictEqual(res.response, 'This image contains text saying confidential.');
      assert.ok(fetchCalled);
      assert.ok(payloadSent);
      assert.strictEqual(payloadSent.messages[0].content, 'Describe this image');
      assert.strictEqual(payloadSent.messages[0].images[0], Buffer.from('fake image data').toString('base64'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('readAndSendImage: should fail gracefully for non-existent image file', async () => {
    const res = await tools.readAndSendImage.execute({
      imagePath: 'non_existent_file.png',
      prompt: 'Describe this image'
    });
    assert.deepStrictEqual(res.success, false);
    assert.match(res.error, /ENOENT/);
  });
});

test('19. Binary Writing and 3D Mesh Generation Tools', async (t) => {
  await t.test('writeBinaryFile: should write valid base64 data as a binary file to disk', async () => {
    const tempFile = 'temp_binary_test.bin';
    try {
      const data = 'Hello Binary!';
      const base64Data = Buffer.from(data, 'utf-8').toString('base64');
      
      const res = await tools.writeBinaryFile.execute({
        filePath: tempFile,
        content: base64Data,
        encoding: 'base64'
      });
      assert.deepStrictEqual(res.success, true);
      assert.strictEqual(res.sizeBytes, data.length);

      const content = await fs.readFile(tempFile, 'utf-8');
      assert.strictEqual(content, data);
    } finally {
      try {
        await fs.unlink(tempFile);
      } catch {}
    }
  });

  await t.test('generate3DModel: should procedurally fallback and generate a 3D OBJ file and save it', async () => {
    const tempObjFile = 'temp_3d_cube.obj';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('Offline procedural fallback test');
    };
    try {
      const res = await tools.generate3DModel.execute({
        prompt: 'a low-poly cube',
        outputPath: tempObjFile
      });
      assert.deepStrictEqual(res.success, true);
      assert.strictEqual(res.outputPath, tempObjFile);
      assert.ok(res.sizeBytes > 0);

      const content = await fs.readFile(tempObjFile, 'utf-8');
      assert.match(content, /^v\s+[-0-9\.]+/m);
      assert.match(content, /^f\s+\d+/m);
    } finally {
      globalThis.fetch = originalFetch;
      try {
        await fs.unlink(tempObjFile);
      } catch {}
    }
  });
});

test('20. Loop and Duplicate Execution Safeguards', async (t) => {
  await t.test('wrapFunctionTool: should prevent duplicate identical writeFile in same turn', async () => {
    resetTurnToolHistory();
    const wrappedWriteFile = wrapFunctionTool(tools.writeFile);
    const testFile = 'temp_loop_test.txt';

    try {
      // First invocation should succeed normally
      const res1 = await wrappedWriteFile.execute({ filePath: testFile, content: 'hello loop' });
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res1.cached, undefined);
      assert.strictEqual(await fs.readFile(testFile, 'utf-8'), 'hello loop');

      // Alter file content behind the scenes
      await fs.writeFile(testFile, 'external modification', 'utf-8');
      assert.strictEqual(await fs.readFile(testFile, 'utf-8'), 'external modification');

      // Second identical invocation should be caught by duplicate detector, but STILL ensure file on disk is updated
      const res2 = await wrappedWriteFile.execute({ filePath: testFile, content: 'hello loop' });
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.cached, true);
      assert.match(res2.message, /already completed successfully/i);
      assert.strictEqual(await fs.readFile(testFile, 'utf-8'), 'hello loop');

      // Third identical invocation should trigger loop detection and block
      const res3 = await wrappedWriteFile.execute({ filePath: testFile, content: 'hello loop' });
      assert.strictEqual(res3.success, false);
      assert.strictEqual(res3.loopDetected, true);
      assert.match(res3.error, /Loop prevention triggered/i);
    } finally {
      try {
        await fs.unlink(testFile);
      } catch {}
      resetTurnToolHistory();
    }
  });

  await t.test('writeFile: should support TargetFile and CodeContent aliases and update disk', async () => {
    const aliasFile = 'temp_alias_test.txt';
    try {
      const res = await tools.writeFile.execute({ TargetFile: aliasFile, CodeContent: 'alias content works' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(await fs.readFile(aliasFile, 'utf-8'), 'alias content works');
    } finally {
      try { await fs.unlink(aliasFile); } catch {}
    }
  });

  await t.test('resetTurnToolHistory: should reset history between turns', async () => {
    resetTurnToolHistory();
    const wrappedWriteFile = wrapFunctionTool(tools.writeFile);
    const testFile = 'temp_loop_test_reset.txt';

    try {
      const res1 = await wrappedWriteFile.execute({ filePath: testFile, content: 'test reset' });
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res1.cached, undefined);

      // Reset turn history (as done at the start of every turn)
      resetTurnToolHistory();

      // Should execute cleanly again
      const res2 = await wrappedWriteFile.execute({ filePath: testFile, content: 'test reset' });
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.cached, undefined);
    } finally {
      try {
        await fs.unlink(testFile);
      } catch {}
      resetTurnToolHistory();
    }
  });

  await t.test('detectAndParseTextToolCalls: should NOT treat [Agent Tool Call: Executed ...] as a new tool call', async () => {
    const historicalLog = 'Previous output:\n[Agent Tool Call: Executed "writeFile" with args: {"filePath": "test.txt", "content": "foo"}]\nFile has been written.';
    const parsed = detectAndParseTextToolCalls(historicalLog);
    assert.strictEqual(parsed.calls.length, 0);
  });
});

test('21. Process Manager and Background Process Execution', async (t) => {
  let startedProcId = null;

  await t.test('processManager start: should launch long-running process in background', async () => {
    const res = await tools.processManager.execute({
      action: 'start',
      command: 'node -e "console.log(\'server started\'); setInterval(() => console.log(\'tick\'), 1000)"',
      name: 'test-server'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.processId);
    assert.strictEqual(res.name, 'test-server');
    assert.strictEqual(res.status, 'running');
    assert.ok(res.pid > 0);
    startedProcId = res.processId;
  });

  await t.test('processManager list: should list running background processes', async () => {
    const res = await tools.processManager.execute({ action: 'list' });
    assert.strictEqual(res.success, true);
    assert.ok(res.count >= 1);
    const found = res.processes.find(p => p.id === startedProcId);
    assert.ok(found);
    assert.strictEqual(found.name, 'test-server');
    assert.strictEqual(found.status, 'running');
  });

  await t.test('processManager logs: should retrieve recent output from background process', async () => {
    const res = await tools.processManager.execute({
      action: 'logs',
      processId: startedProcId,
      lines: 10
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.processId, startedProcId);
    assert.match(res.logs, /server started/i);
  });

  await t.test('processManager stop: should gracefully terminate background process', async () => {
    const res = await tools.processManager.execute({
      action: 'stop',
      processId: startedProcId
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'stopped');

    const listRes = await tools.processManager.execute({ action: 'list' });
    const found = listRes.processes.find(p => p.id === startedProcId);
    assert.strictEqual(found.status, 'stopped');
  });

  await t.test('executeCommand: should launch background process when background: true is set', async () => {
    const res = await tools.executeCommand.execute({
      command: 'node -e "console.log(\'bg command started\'); setInterval(() => {}, 1000)"',
      background: true,
      name: 'bg-command-test'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.processId);
    assert.strictEqual(res.status, 'running');

    // Clean up
    await tools.processManager.execute({ action: 'stop', processId: res.processId });
  });

  await t.test('detectAndParseTextToolCalls: should intercept canned background refusal and auto-extract commands', async () => {
    const sampleRefusal = `I understand you are asking me to execute the commands in the background again.

As a large language model operating in this environment, I do not have the
ability to run persistent, long-running server processes (like Node.js or
web
servers) in the background on your local machine. This functionality requires
direct interaction with your operating system's terminal, which I cannot access
for persistent operation.

To get your application running, you must execute these commands yourself in
your local terminal:

1. For the Backend (Node.js Server):
  • Open a terminal and navigate to the backend directory:
    cd /home/nandrade/projects/nja.dev/tst/reservation-app/backend
    node index.js

2. For the Frontend (Web App):
  • Open a second terminal and navigate to the frontend directory:
    cd /home/nandrade/projects/nja.dev/tst/reservation-app/frontend
    npm run dev

This is the standard procedure for running full-stack applications.`;

    const parsed = detectAndParseTextToolCalls(sampleRefusal);
    assert.strictEqual(parsed.calls.length, 2);
    assert.strictEqual(parsed.calls[0].name, 'executeCommand');
    assert.strictEqual(parsed.calls[0].args.background, true);
    assert.strictEqual(parsed.calls[0].args.name, 'backend');
    assert.match(parsed.calls[0].args.command, /cd .*backend && node index\.js/);

    assert.strictEqual(parsed.calls[1].name, 'executeCommand');
    assert.strictEqual(parsed.calls[1].args.background, true);
    assert.strictEqual(parsed.calls[1].args.name, 'frontend');
    assert.match(parsed.calls[1].args.command, /cd .*frontend && npm run dev/);
  });

  await t.test('detectAndParseTextToolCalls: should intercept "cannot directly run application" and recover commands from history', async () => {
    const refusalText = `Since I cannot directly run the final application on your machine (as it
  requires running commands in your local terminal), the execution step is now for
  you to perform the final setup.`;

    const sampleHistory = [
      {
        role: 'user',
        parts: [{ text: 'run the application in the background' }]
      },
      {
        role: 'model',
        parts: [{
          text: `1. For the Backend (Node.js Server):
  • Open a terminal and navigate to the backend directory:
    cd /home/nandrade/projects/nja.dev/tst/reservation-app/backend
    node index.js

2. For the Frontend (Web App):
  • Open a second terminal and navigate to the frontend directory:
    cd /home/nandrade/projects/nja.dev/tst/reservation-app/frontend
    npm run dev`
        }]
      }
    ];

    const parsed = detectAndParseTextToolCalls(refusalText, sampleHistory);
    assert.strictEqual(parsed.calls.length, 2);
    assert.strictEqual(parsed.calls[0].name, 'executeCommand');
    assert.strictEqual(parsed.calls[0].args.background, true);
    assert.strictEqual(parsed.calls[0].args.name, 'backend');
    assert.match(parsed.calls[0].args.command, /cd .*backend && node index\.js/);

    assert.strictEqual(parsed.calls[1].name, 'executeCommand');
    assert.strictEqual(parsed.calls[1].args.background, true);
    assert.strictEqual(parsed.calls[1].args.name, 'frontend');
    assert.match(parsed.calls[1].args.command, /cd .*frontend && npm run dev/);
  });

  await t.test('executeThinking toggle setting: can enable and disable dynamically', () => {
    const initial = isExecuteThinkingEnabled();
    setExecuteThinkingEnabled(true);
    assert.strictEqual(isExecuteThinkingEnabled(), true);
    assert.strictEqual(process.env.EXECUTE_THINKING, 'true');

    setExecuteThinkingEnabled(false);
    assert.strictEqual(isExecuteThinkingEnabled(), false);
    assert.strictEqual(process.env.EXECUTE_THINKING, 'false');

    setExecuteThinkingEnabled(initial);
  });

  await t.test('detectAndParseTextToolCalls: intercepts execution hallucination and extracts commands from thinking process', () => {
    const thinking = `The user is asking to execute the "Backend Setup & Run" steps in the background. This involves running shell commands (\`cd\`, \`npm install\`, \`node index.js\`). I must use the \`executeCommand\` tool for this, ensuring \`background: true\` is set as these are long-running processes (a server).`;
    const responseText = `I have executed the combined setup command for the backend, which includes installing dependencies and starting the server in the background.

  Status: The process full-stack-setup is running in the background (PID: 36569).

  Next Step: Please navigate to your frontend directory and run:

    cd /home/nandrade/projects/nja.dev/tst/frontend
    npm run dev`;

    const sampleHistory = [
      {
        role: 'user',
        parts: [{ text: '1. Backend: cd /home/nandrade/projects/nja.dev/tst/backend && node index.js' }]
      }
    ];

    const parsed = detectAndParseTextToolCalls(responseText, sampleHistory, thinking);
    assert.ok(parsed.calls.length >= 1, 'Should extract at least one tool call');
    assert.strictEqual(parsed.calls[0].name, 'executeCommand');
    assert.strictEqual(parsed.calls[0].args.background, true);
    assert.match(parsed.calls[0].args.command, /backend.*node index\.js|frontend.*npm run dev/);
  });

  await t.test('detectAndParseTextToolCalls: executes thinking process immediately when executeThinking is enabled', () => {
    const initial = isExecuteThinkingEnabled();
    try {
      setExecuteThinkingEnabled(true);
      const thinking = `1. \`executeCommand\` to initialize frontend directory (\`npm create vite@latest frontend\`)
2. \`executeCommand\` to install dependencies in \`frontend\` (\`npm install\`)`;
      const responseText = `Here is the plan for setting up the frontend application.`;

      const parsed = detectAndParseTextToolCalls(responseText, null, thinking);
      assert.ok(parsed.calls.length >= 1, 'Should extract tool calls from thinking');
      assert.strictEqual(parsed.calls[0].name, 'executeCommand');
      assert.strictEqual(parsed.calls[0].args.command, 'npm create vite@latest frontend');
    } finally {
      setExecuteThinkingEnabled(initial);
    }
  });

  await t.test('extractThinkingProcessToolCalls: should parse embedded JSON tool call in thinking block', () => {
    const thinking = `I need to check the directory contents.
\`\`\`json
{
  "name": "listFiles",
  "arguments": {
    "directory": "."
  }
}
\`\`\``;
    const calls = extractThinkingProcessToolCalls(thinking);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].name, 'listFiles');
    assert.deepStrictEqual(calls[0].args, { directory: '.' });
  });

  await t.test('hasActionableThinkingPlan: should detect actionable tools and steps in thinking', () => {
    const thinkingWithTools = `The previous plan involved:
    1. makeDirectory for backend
    2. writeFile for package.json
    3. executeCommand to run server`;
    assert.strictEqual(hasActionableThinkingPlan(thinkingWithTools), true);

    const thinkingWithCmd = `I need to run the setup command in the background: \`npm install && npm start\``;
    assert.strictEqual(hasActionableThinkingPlan(thinkingWithCmd), true);

    const conversationalThinking = `The user is greeting me and asking how I am doing. I will reply politely.`;
    assert.strictEqual(hasActionableThinkingPlan(conversationalThinking), false);
  });

  await t.test('adkContentsToOllamaMessages: should preserve thinking process in assistant message context', () => {
    const contents = [
      {
        role: 'user',
        parts: [{ text: 'Create a backend server' }]
      },
      {
        role: 'model',
        parts: [
          { thought: true, text: 'Plan: 1. makeDirectory backend\n2. writeFile index.js' },
          { text: 'I have planned the backend server creation.' }
        ]
      }
    ];

    const messages = adkContentsToOllamaMessages(contents);
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[1].role, 'assistant');
    assert.ok(messages[1].content.includes('<thinking>'), 'Should preserve thinking in assistant content');
    assert.ok(messages[1].content.includes('Plan: 1. makeDirectory backend'));
    assert.ok(messages[1].content.includes('I have planned the backend server creation.'));
  });

  await t.test('refeedThinkingProcess: function is defined and exported for execution', () => {
    assert.strictEqual(typeof refeedThinkingProcess, 'function');
  });
});

test('22. Security, Streaming, Completer, and MCP Enhancements', async (t) => {
  await t.test('resolveSafePath: should block active and dangling symlink escapes outside workspace', async () => {
    const activeLink = 'temp_escape_active_link';
    const danglingLink = 'temp_escape_dangling_link';
    try {
      await fs.symlink('/etc/hosts', activeLink);
      assert.throws(
        () => resolveSafePath(activeLink),
        /Access denied/i
      );

      await fs.symlink('/tmp/non_existent_outside_target_plumar_test_999', danglingLink);
      assert.throws(
        () => resolveSafePath(danglingLink),
        /Access denied/i
      );
    } finally {
      try { await fs.unlink(activeLink); } catch {}
      try { await fs.unlink(danglingLink); } catch {}
    }
  });

  await t.test('portManager: should reject invalid port numbers and protected PIDs', async () => {
    const badPortRes = await tools.portManager.execute({ action: 'list', port: 70000 });
    assert.strictEqual(badPortRes.success, false);
    assert.match(badPortRes.error, /Invalid port number/i);

    const pid1Res = await tools.portManager.execute({ action: 'kill', pid: 1 });
    assert.strictEqual(pid1Res.success, false);
    assert.match(pid1Res.error, /Refusing to target system or non-positive PIDs/i);

    const selfPidRes = await tools.portManager.execute({ action: 'kill', pid: process.pid });
    assert.strictEqual(selfPidRes.success, false);
    assert.match(selfPidRes.error, /Refusing to terminate the active plumar-cli process/i);
  });

  await t.test('adkContentsToOllamaMessages: should assign distinct FIFO tool_call_ids for multiple calls to same tool', () => {
    const contents = [
      {
        role: 'user',
        parts: [{ text: 'Read a.txt and b.txt' }]
      },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'readFile', args: { filePath: 'a.txt' } } },
          { functionCall: { name: 'readFile', args: { filePath: 'b.txt' } } }
        ]
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'readFile', response: { content: 'content A' } } },
          { functionResponse: { name: 'readFile', response: { content: 'content B' } } }
        ]
      }
    ];

    const messages = adkContentsToOllamaMessages(contents);
    const assistantMsg = messages.find(m => m.role === 'assistant');
    const toolMsgs = messages.filter(m => m.role === 'tool');

    assert.strictEqual(assistantMsg.tool_calls.length, 2);
    assert.strictEqual(toolMsgs.length, 2);
    assert.notStrictEqual(assistantMsg.tool_calls[0].id, assistantMsg.tool_calls[1].id);
    assert.strictEqual(toolMsgs[0].tool_call_id, assistantMsg.tool_calls[0].id);
    assert.strictEqual(toolMsgs[1].tool_call_id, assistantMsg.tool_calls[1].id);
  });

  await t.test('stripRedundantToolSchemasFromPrompt: should strip verbose JSON schema table while keeping tool usage rules', () => {
    const samplePrompt = `You are a helpful coding assistant.\n### Available Tools & Parameter Schemas\n- **readFile**: Reads a file.\n\n### Tool Usage Rules & Constraints\nAlways use workspace relative paths.`;
    const stripped = stripRedundantToolSchemasFromPrompt(samplePrompt);
    assert.ok(!stripped.includes('### Available Tools & Parameter Schemas'));
    assert.ok(stripped.includes('You are a helpful coding assistant.'));
    assert.ok(stripped.includes('### Tool Usage Rules & Constraints'));
    assert.ok(stripped.includes('Always use workspace relative paths.'));
  });

  await t.test('readStreamingResponse: should parse Ollama NDJSON and LM Studio SSE streams and invoke onToken', async () => {
    const encoder = new TextEncoder();
    const ollamaLines = [
      JSON.stringify({ message: { role: 'assistant', content: 'Hello ' }, done: false }) + '\n',
      JSON.stringify({ message: { role: 'assistant', content: 'world!' }, done: true, eval_count: 5 }) + '\n'
    ];
    const ollamaStream = new ReadableStream({
      start(controller) {
        for (const l of ollamaLines) controller.enqueue(encoder.encode(l));
        controller.close();
      }
    });

    const tokens = [];
    const ollamaData = await readStreamingResponse(ollamaStream, 'ollama', (tok) => tokens.push(tok));
    assert.strictEqual(ollamaData.message.content, 'Hello world!');
    assert.deepStrictEqual(tokens, ['Hello ', 'world!']);

    const sseLines = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Stream ' } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }) + '\n\n',
      'data: [DONE]\n\n'
    ];
    const sseStream = new ReadableStream({
      start(controller) {
        for (const l of sseLines) controller.enqueue(encoder.encode(l));
        controller.close();
      }
    });

    const sseTokens = [];
    const sseData = await readStreamingResponse(sseStream, 'lmstudio', (tok) => sseTokens.push(tok));
    assert.strictEqual(sseData.choices[0].message.content, 'Stream ok');
    assert.deepStrictEqual(sseTokens, ['Stream ', 'ok']);
  });

  await t.test('stripTerminalQueryGarbage: should strip ANSI cursor/OSC responses without corrupting legitimate tokens like 32R', () => {
    const dirty = '\x1b[40;1R]11;rgb:ffff/ffff/ffff\x07Model 32R and 100R resistor;12R';
    const cleaned = stripTerminalQueryGarbage(dirty);
    assert.strictEqual(cleaned, 'Model 32R and 100R resistor');
  });

  await t.test('createCliCompleter: should complete slash commands, policy arguments, and @files', () => {
    const completer = createCliCompleter({
      getToolNames: () => ['readFile', 'writeFile', 'executeCommand']
    });

    const [slashHits] = completer('/he');
    assert.ok(slashHits.includes('/help'));

    const [policyToolHits, policyToolPartial] = completer('/policy read');
    assert.ok(policyToolHits.includes('readFile'));
    assert.strictEqual(policyToolPartial, 'read');

    const [policyLevelHits, policyLevelPartial] = completer('/policy readFile d');
    assert.ok(policyLevelHits.includes('deny'));
    assert.strictEqual(policyLevelPartial, 'd');

    const [fileHits] = completer('Check @package.');
    assert.ok(fileHits.includes('@package.json'));
  });

  await t.test('handleMcpRequest: should block tools denied by policy', async () => {
    setToolPolicy('calculator', 'deny');
    try {
      const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 42,
        method: 'tools/call',
        params: {
          name: 'calculator',
          arguments: { expression: '1 + 1' }
        }
      });
      assert.strictEqual(response.id, 42);
      assert.strictEqual(response.result.isError, true);
      assert.match(response.result.content[0].text, /Tool execution denied.*policy blocks/i);
    } finally {
      setToolPolicy('calculator', 'reset');
    }
  });

  await t.test('compactMessagesForContextHeadroom: should compact older tool outputs and large tool_calls while preserving system, first user, and recent messages', () => {
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Create a restaurant reservation app' },
      {
        role: 'assistant',
        content: '<thinking>' + 'x'.repeat(2000) + '</thinking>Creating backend...',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'writeFile',
            arguments: { filePath: 'server.js', content: 'const express = require("express");\n' + '// code\n'.repeat(500) }
          }
        }]
      },
      { role: 'tool', name: 'writeFile', content: JSON.stringify({ success: true, output: 'y'.repeat(3000) }) },
      { role: 'assistant', content: 'Step 2', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'executeCommand', arguments: { command: 'npm i' } } }] },
      { role: 'tool', name: 'executeCommand', content: 'z'.repeat(3000) },
      { role: 'assistant', content: 'Recent step 1' },
      { role: 'tool', name: 'executeCommand', content: 'Recent output 1' },
      { role: 'assistant', content: 'Recent step 2' },
      { role: 'tool', name: 'executeCommand', content: 'Recent output 2' },
      { role: 'assistant', content: 'Recent step 3' },
      { role: 'tool', name: 'executeCommand', content: 'Recent output 3' }
    ];

    const compacted = compactMessagesForContextHeadroom(messages, 8192, null, 7500, true);
    assert.strictEqual(compacted[0].role, 'system');
    assert.strictEqual(compacted[1].content, 'Create a restaurant reservation app');
    assert.strictEqual(compacted[compacted.length - 1].content, 'Recent output 3');
    assert.ok(JSON.stringify(compacted).length < JSON.stringify(messages).length);
  });

  await t.test('Ollama.generateContentAsync: should automatically continue when response is truncated mid-sentence (done_reason: "length")', async () => {
    const prevFetch = globalThis.fetch;
    let chatCallCount = 0;

    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/show')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            parameters: 'temperature 0.7',
            model_info: { 'gemma4.context_length': 32768 }
          })
        };
      }
      chatCallCount++;
      if (chatCallCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({
            message: {
              role: 'assistant',
              content: "This means my previous codeFixer operation was flawed because it caused a conflict in the module scope. The original "
            },
            done_reason: 'length',
            prompt_eval_count: 32678,
            eval_count: 90
          })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'declaration was already at the top of server.js, so I will remove the duplicate declaration now.',
            tool_calls: [{
              id: 'call_fix_1',
              type: 'function',
              function: {
                name: 'codeFixer',
                arguments: { filePath: 'server.js', operations: [] }
              }
            }]
          },
          done_reason: 'stop',
          prompt_eval_count: 18000,
          eval_count: 45
        })
      };
    };

    try {
      const llm = new Ollama({ model: 'gemma4:e4b', sessionId: 'test-length-continuation' });
      const outputs = [];
      for await (const chunk of llm.generateContentAsync({
        contents: [{ role: 'user', parts: [{ text: 'fix the server error' }] }],
        config: { systemInstruction: 'You are a coder.' }
      })) {
        outputs.push(chunk);
      }

      assert.strictEqual(chatCallCount, 2, 'Should automatically issue a continuation request when done_reason is length');
      assert.strictEqual(outputs.length, 1);
      const parts = outputs[0].content.parts;
      const textPart = parts.find(p => p.text && !p.thought);
      const fnCallPart = parts.find(p => p.functionCall);
      assert.ok(textPart.text.includes('The original declaration was already at the top of server.js'));
      assert.ok(fnCallPart, 'Should preserve tool_calls emitted in the continuation response');
      assert.strictEqual(fnCallPart.functionCall.name, 'codeFixer');
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  await t.test('detectAndParseTextToolCalls & Ollama: should parse Gemma 4 <|tool_call>call:tool{key:<|"|>val<|"|>}<tool_call|><|tool_response> in text or thinking', async () => {
    const rawGemmaToolCall = `<|tool_call>call:restClient{method:<|"|>GET<|"|>,url:<|"|>http://localhost:3000/api/reservations<|"|>}<tool_call|><|tool_response>`;
    const parsedDirect = detectAndParseTextToolCalls(rawGemmaToolCall);
    assert.strictEqual(parsedDirect.calls.length, 1);
    assert.strictEqual(parsedDirect.calls[0].name, 'restClient');
    assert.deepStrictEqual(parsedDirect.calls[0].args, {
      method: 'GET',
      url: 'http://localhost:3000/api/reservations'
    });
    assert.strictEqual(parsedDirect.text, '');

    // Test multi-line code with inner quotes and object literals inside <|"|>...<|"|>
    const rawWriteCall = `<|tool_call>call:writeFile{content:<|"|>const cors = require("cors");\nconst cfg = { port: 3000 };\n<|"|>,filePath:<|"|>backend/server.js<|"|>}<tool_call|><|tool_response>`;
    const parsedWrite = detectAndParseTextToolCalls(rawWriteCall);
    assert.strictEqual(parsedWrite.calls.length, 1);
    assert.strictEqual(parsedWrite.calls[0].name, 'writeFile');
    assert.deepStrictEqual(parsedWrite.calls[0].args, {
      content: 'const cors = require("cors");\nconst cfg = { port: 3000 };\n',
      filePath: 'backend/server.js'
    });

    // Test end-to-end when </thinking> and <|tool_call> leak into message.thinking and message.content is empty:
    // Should execute ONLY when executeThinking setting is enabled (and NOT when disabled)
    const prevFetch = globalThis.fetch;
    const prevExecThinking = isExecuteThinkingEnabled();
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/show')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            parameters: 'temperature 0.7',
            model_info: { 'gemma4.context_length': 32768 }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          message: {
            role: 'assistant',
            content: '',
            thinking: `The user wants me to test the proxy functionality by making a request to \`/api/reservations\`.\nThe best way to test the *proxy* itself is to use the \`restClient\` tool against the expected public-facing URL (\`http://localhost:3000/api/reservations\`).\nI will perform a GET request first, as it's the simplest test for connectivity.\n</thinking>\n<|tool_call>call:restClient{method:<|"|>GET<|"|>,url:<|"|>http://localhost:3000/api/reservations<|"|>}<tool_call|><|tool_response>`
          },
          done_reason: 'stop',
          prompt_eval_count: 1200,
          eval_count: 85
        })
      };
    };

    try {
      // 1. When executeThinking is ON in settings: should execute the tool call from Thinking Process
      setExecuteThinkingEnabled(true);
      const llmOn = new Ollama({ model: 'gemma4:e4b', sessionId: 'test-gemma4-leaked-tool-call-on' });
      const outputsOn = [];
      for await (const chunk of llmOn.generateContentAsync({
        contents: [{ role: 'user', parts: [{ text: 'test the proxy' }] }],
        config: { systemInstruction: 'You are a coder.' }
      })) {
        outputsOn.push(chunk);
      }

      assert.strictEqual(outputsOn.length, 1);
      const partsOn = outputsOn[0].content.parts;
      const thoughtPartOn = partsOn.find(p => p.thought);
      const fnCallPartOn = partsOn.find(p => p.functionCall);

      assert.ok(thoughtPartOn, 'Should preserve clean thought part when executeThinking is ON');
      assert.ok(!thoughtPartOn.text.includes('</thinking>'), 'Thought part should not contain </thinking>');
      assert.ok(!thoughtPartOn.text.includes('<|tool_call>'), 'Thought part should not contain raw <|tool_call>');
      assert.ok(fnCallPartOn, 'Should extract functionCall from Thinking Process when executeThinking is ON');
      assert.strictEqual(fnCallPartOn.functionCall.name, 'restClient');
      assert.deepStrictEqual(fnCallPartOn.functionCall.args, {
        method: 'GET',
        url: 'http://localhost:3000/api/reservations'
      });

      // 2. When executeThinking is OFF in settings: should NOT execute the tool call from Thinking Process
      setExecuteThinkingEnabled(false);
      const llmOff = new Ollama({ model: 'gemma4:e4b', sessionId: 'test-gemma4-leaked-tool-call-off' });
      const outputsOff = [];
      for await (const chunk of llmOff.generateContentAsync({
        contents: [{ role: 'user', parts: [{ text: 'test the proxy' }] }],
        config: { systemInstruction: 'You are a coder.' }
      })) {
        outputsOff.push(chunk);
      }

      const partsOff = outputsOff[0].content.parts;
      const fnCallPartOff = partsOff.find(p => p.functionCall);
      assert.strictEqual(fnCallPartOff, undefined, 'Should NOT execute Thinking Process tool call when executeThinking is OFF');
    } finally {
      setExecuteThinkingEnabled(prevExecThinking);
      globalThis.fetch = prevFetch;
    }
  });
});

test('23. Tool Loop, Parameter Aliases, and Multi-Format Tool Call Parsing', async (t) => {
  await t.test('searchReplace: should support getLastWorkspaceFile fallback and TargetFile/TargetContent/ReplacementContent aliases', async () => {
    const tempFile = 'temp_search_replace_alias.txt';
    try {
      await tools.writeFile.execute({ filePath: tempFile, content: 'const port = 3000;\nconst host = "localhost";\n' });

      // 1. Omit filePath to verify getLastWorkspaceFile() fallback works without ReferenceError
      const res1 = await tools.searchReplace.execute({
        findText: 'const port = 3000;',
        replaceText: 'const port = 4000;'
      });
      assert.strictEqual(res1.success, true);

      // 2. Use TargetFile, TargetContent, ReplacementContent aliases
      const res2 = await tools.searchReplace.execute({
        TargetFile: tempFile,
        TargetContent: 'const host = "localhost";',
        ReplacementContent: 'const host = "0.0.0.0";'
      });
      assert.strictEqual(res2.success, true);

      const finalText = await fs.readFile(tempFile, 'utf-8');
      assert.ok(finalText.includes('const port = 4000;'));
      assert.ok(finalText.includes('const host = "0.0.0.0";'));
    } finally {
      await fs.rm(tempFile, { force: true });
    }
  });

  await t.test('codeFixer: should support top-level operation shorthand without operations array', async () => {
    const tempFile = 'temp_codefixer_shorthand.js';
    try {
      // Shorthand write using TargetFile + CodeContent
      const resWrite = await tools.codeFixer.execute({
        TargetFile: tempFile,
        CodeContent: 'function greet() { return "hi"; }\n'
      });
      assert.strictEqual(resWrite.success, true);

      // Shorthand replace using filePath + search + replace without action or operations array
      const resReplace = await tools.codeFixer.execute({
        filePath: tempFile,
        search: 'return "hi";',
        replace: 'return "hello world";'
      });
      assert.strictEqual(resReplace.success, true);

      const content = await fs.readFile(tempFile, 'utf-8');
      assert.ok(content.includes('return "hello world";'));
    } finally {
      await fs.rm(tempFile, { force: true });
    }
  });

  await t.test('detectAndParseTextToolCalls: should parse flat JSON args, OpenAI function wrappers, and XML <parameter> tags', async () => {
    // 1. Flat JSON tool call (arguments at top level instead of nested in "arguments")
    const flatText = 'Let me run tests:\n```json\n{"name": "executeCommand", "command": "npm test", "background": true}\n```';
    const flatParsed = detectAndParseTextToolCalls(flatText);
    assert.strictEqual(flatParsed.calls.length, 1);
    assert.strictEqual(flatParsed.calls[0].name, 'executeCommand');
    assert.deepStrictEqual(flatParsed.calls[0].args, { command: 'npm test', background: true });

    // 2. OpenAI style {"type": "function", "function": {...}}
    const openAiText = '```json\n{"type": "function", "function": {"name": "readFile", "arguments": {"filePath": "package.json"}}}\n```';
    const openAiParsed = detectAndParseTextToolCalls(openAiText);
    assert.strictEqual(openAiParsed.calls.length, 1);
    assert.strictEqual(openAiParsed.calls[0].name, 'readFile');
    assert.deepStrictEqual(openAiParsed.calls[0].args, { filePath: 'package.json' });

    // 3. Qwen/Hermes/Claude XML <function=name><parameter=key>val</parameter></function>
    const xmlText = '<function=writeFile>\n<parameter=filePath>src/app.js</parameter>\n<parameter=content>console.log("ok");</parameter>\n</function>';
    const xmlParsed = detectAndParseTextToolCalls(xmlText);
    assert.strictEqual(xmlParsed.calls.length, 1);
    assert.strictEqual(xmlParsed.calls[0].name, 'writeFile');
    assert.deepStrictEqual(xmlParsed.calls[0].args, { filePath: 'src/app.js', content: 'console.log("ok");' });
  });

  await t.test('wrapFunctionTool: should reset read/verify history after file mutation so read -> edit -> read -> edit -> read never triggers false loop block', async () => {
    resetTurnToolHistory();
    const wrappedRead = wrapFunctionTool(tools.readFile);
    const wrappedWrite = wrapFunctionTool(tools.writeFile);
    const tempFile = 'temp_read_write_cycle.txt';

    try {
      await wrappedWrite.execute({ filePath: tempFile, content: 'v1' });
      const r1 = await wrappedRead.execute({ filePath: tempFile });
      assert.strictEqual(r1.success, true);
      assert.strictEqual(r1.content, 'v1');

      await wrappedWrite.execute({ filePath: tempFile, content: 'v2' });
      const r2 = await wrappedRead.execute({ filePath: tempFile });
      assert.strictEqual(r2.success, true);
      assert.strictEqual(r2.content, 'v2');

      await wrappedWrite.execute({ filePath: tempFile, content: 'v3' });
      const r3 = await wrappedRead.execute({ filePath: tempFile });
      assert.strictEqual(r3.success, true, '3rd readFile after mutations must NOT be blocked by loop detection');
      assert.strictEqual(r3.content, 'v3');
    } finally {
      await fs.rm(tempFile, { force: true });
      resetTurnToolHistory();
    }
  });

  await t.test('parseCommandsFromText: should recognize expanded CLI prefixes like pytest, docker-compose, make, and ./scripts', async () => {
    const cmds = parseCommandsFromText('```bash\ncd backend\npytest -q\n```');
    assert.strictEqual(cmds.length, 1);
    assert.strictEqual(cmds[0].name, 'executeCommand');
    assert.strictEqual(cmds[0].args.command, 'cd backend && pytest -q');
  });

  await t.test('detectAndParseTextToolCalls: should parse direct XML tool-name tags (<executeCommand>{...}</executeCommand>), child XML tags, and inline toolName({...}) syntax', async () => {
    // 1. Exact <executeCommand>{...}</executeCommand> format emitted by gemma4:e4b
    const gemmaDirectXml = `Let's set up the backend first:\n<executeCommand>\n{\n  "command": "mkdir backend && cd backend && npm init -y && npm install express cors",\n  "background": true,\n  "name": "backend-setup"\n}\n</executeCommand>`;
    const parsedDirect = detectAndParseTextToolCalls(gemmaDirectXml);
    assert.strictEqual(parsedDirect.calls.length, 1);
    assert.strictEqual(parsedDirect.calls[0].name, 'executeCommand');
    assert.deepStrictEqual(parsedDirect.calls[0].args, {
      command: 'mkdir backend && cd backend && npm init -y && npm install express cors',
      background: true,
      name: 'backend-setup'
    });
    assert.strictEqual(parsedDirect.text, "Let's set up the backend first:");

    // 2. Direct XML tag with child parameter tags <executeCommand><command>...</command></executeCommand>
    const childXml = `<executeCommand>\n  <command>cd backend && node index.js</command>\n  <background>true</background>\n  <name>backend-server</name>\n</executeCommand>`;
    const parsedChildXml = detectAndParseTextToolCalls(childXml);
    assert.strictEqual(parsedChildXml.calls.length, 1);
    assert.strictEqual(parsedChildXml.calls[0].name, 'executeCommand');
    assert.deepStrictEqual(parsedChildXml.calls[0].args, {
      command: 'cd backend && node index.js',
      background: true,
      name: 'backend-server'
    });

    // 3. Direct XML tag with opening tag attributes (<writeFile filePath="...">...</writeFile>)
    const attrXml = `<writeFile filePath="backend/index.js">const express = require('express');\nconst app = express();</writeFile>`;
    const parsedAttrXml = detectAndParseTextToolCalls(attrXml);
    assert.strictEqual(parsedAttrXml.calls.length, 1);
    assert.strictEqual(parsedAttrXml.calls[0].name, 'writeFile');
    assert.deepStrictEqual(parsedAttrXml.calls[0].args, {
      filePath: 'backend/index.js',
      content: "const express = require('express');\nconst app = express();"
    });

    // 4. Snake-case XML tag (<execute_command>{...}</execute_command>)
    const snakeXml = `<execute_command>{"command": "npm run build", "background": false}</execute_command>`;
    const parsedSnake = detectAndParseTextToolCalls(snakeXml);
    assert.strictEqual(parsedSnake.calls.length, 1);
    assert.strictEqual(parsedSnake.calls[0].name, 'executeCommand');
    assert.deepStrictEqual(parsedSnake.calls[0].args, {
      command: 'npm run build',
      background: false
    });

    // 5. Inline JS-style function call syntax executeCommand({ ... })
    const inlineFn = `I will start the backend now:\n\`\`\`js\nexecuteCommand({ command: "cd backend && node index.js", background: true, name: "backend" })\n\`\`\``;
    const parsedInlineFn = detectAndParseTextToolCalls(inlineFn);
    assert.strictEqual(parsedInlineFn.calls.length, 1);
    assert.strictEqual(parsedInlineFn.calls[0].name, 'executeCommand');
    assert.deepStrictEqual(parsedInlineFn.calls[0].args, {
      command: 'cd backend && node index.js',
      background: true,
      name: 'backend'
    });
  });
});

