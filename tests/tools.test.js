import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { tools } from '../src/tools.js';
import { Jimp } from 'jimp';

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
        prompt: 'a small cute potato image'
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





