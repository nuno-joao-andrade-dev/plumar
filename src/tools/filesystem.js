import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import { resolveSafePath, WORKSPACE_DIR } from './core-helper.js';

export const filesystemTools = {
  listFiles: new FunctionTool({
    name: 'listFiles',
    description: 'List files in the workspace. Automatically ignores node_modules, .git, and build artifacts to keep the response clean.',
    parameters: z.object({
      directory: z.string().optional().describe('The relative directory to list, defaults to the workspace root "."'),
      path: z.string().optional().describe('Alternative parameter name for directory'),
      directoryPath: z.string().optional().describe('Alternative parameter name for directory'),
    }),
    execute: async (args = {}) => {
      try {
        const directory = args.directory || args.path || args.directoryPath || '.';
        const targetPath = resolveSafePath(directory);
        
        const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json'];
        
        const listDirRecursive = async (currentPath, relativePrefix = '') => {
          let results = [];
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            if (ignoreDirs.includes(entry.name)) continue;
            
            const relativePath = path.join(relativePrefix, entry.name);
            if (entry.isDirectory()) {
              results.push({ name: relativePath, type: 'directory' });
              try {
                const subResults = await listDirRecursive(path.join(currentPath, entry.name), relativePath);
                results = results.concat(subResults);
              } catch {
                // Ignore subdirs we can't read
              }
            } else {
              const stats = await fs.stat(path.join(currentPath, entry.name));
              results.push({
                name: relativePath,
                type: 'file',
                sizeBytes: stats.size,
              });
            }
          }
          return results;
        };
        
        const files = await listDirRecursive(targetPath);
        return { success: true, files };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  readFile: new FunctionTool({
    name: 'readFile',
    description: 'Read the contents of a text file in the workspace. Returns the first 10,000 characters to prevent flooding context.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to read'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const targetPath = resolveSafePath(filePath);
        const stats = await fs.stat(targetPath);
        
        if (!stats.isFile()) {
          return { success: false, error: 'The specified path is not a file.' };
        }
        
        const content = await fs.readFile(targetPath, 'utf-8');
        const isTruncated = content.length > 10000;
        const resultText = isTruncated ? content.slice(0, 10000) + '\n[... TRUNCATED DUE TO SIZE LIMIT ...]' : content;
        
        return {
          success: true,
          filePath,
          sizeBytes: stats.size,
          isTruncated,
          content: resultText,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  writeFile: new FunctionTool({
    name: 'writeFile',
    description: 'Create a new text file or overwrite an existing one with new content in the workspace.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to write'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
      content: z.string().describe('The text content to write to the file'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const content = args.content !== undefined ? args.content : '';
        const targetPath = resolveSafePath(filePath);
        
        // Ensure directory structure exists
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        await fs.writeFile(targetPath, content, 'utf-8');
        const stats = await fs.stat(targetPath);
        
        return {
          success: true,
          filePath,
          sizeBytes: stats.size,
          message: `Successfully wrote ${content.length} characters to ${filePath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  appendFile: new FunctionTool({
    name: 'appendFile',
    description: 'Append text content to an existing file in the workspace.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to append to'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
      content: z.string().describe('The text content to append'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const content = args.content !== undefined ? args.content : '';
        const targetPath = resolveSafePath(filePath);
        
        // Ensure directory structure exists (just in case)
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        await fs.appendFile(targetPath, content, 'utf-8');
        const stats = await fs.stat(targetPath);
        
        return {
          success: true,
          filePath,
          sizeBytes: stats.size,
          message: `Successfully appended ${content.length} characters to ${filePath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  deleteFile: new FunctionTool({
    name: 'deleteFile',
    description: 'Safely delete a file from the workspace.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the file to delete'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const targetPath = resolveSafePath(filePath);
        const stats = await fs.stat(targetPath);
        
        if (!stats.isFile()) {
          return { success: false, error: 'The specified path is not a file and cannot be deleted.' };
        }
        
        await fs.unlink(targetPath);
        return {
          success: true,
          filePath,
          message: `Successfully deleted file ${filePath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  makeDirectory: new FunctionTool({
    name: 'makeDirectory',
    description: 'Explicitly create a new directory (and any parent directories) in the workspace.',
    parameters: z.object({
      directoryPath: z.string().optional().describe('The relative path of the directory to create'),
      path: z.string().optional().describe('Alternative parameter name for directoryPath'),
      directory: z.string().optional().describe('Alternative parameter name for directoryPath'),
    }),
    execute: async (args = {}) => {
      try {
        const directoryPath = args.directoryPath || args.path || args.directory || args.filePath;
        if (!directoryPath) {
          return { success: false, error: 'Missing required parameter: directoryPath, path, or directory' };
        }
        const targetPath = resolveSafePath(directoryPath);
        await fs.mkdir(targetPath, { recursive: true });
        return {
          success: true,
          directoryPath,
          message: `Successfully created directory ${directoryPath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  searchGrep: new FunctionTool({
    name: 'searchGrep',
    description: 'Search for text or a regular expression within text files in the workspace (excluding node_modules, .git, etc.).',
    parameters: z.object({
      query: z.string().optional().describe('The search query string or regex pattern'),
      directory: z.string().optional().describe('The relative subdirectory to search within, defaults to "."'),
      path: z.string().optional().describe('Alternative parameter name for directory'),
      directoryPath: z.string().optional().describe('Alternative parameter name for directory'),
      isRegex: z.boolean().optional().default(false).describe('Whether to treat the query as a regular expression pattern'),
    }),
    execute: async (args = {}) => {
      try {
        const query = args.query;
        if (!query) {
          return { success: false, error: 'Missing required parameter: query' };
        }
        const directory = args.directory || args.path || args.directoryPath || '.';
        const isRegex = args.isRegex !== undefined ? args.isRegex : false;
        const targetPath = resolveSafePath(directory);
        const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json'];
        
        const searchInDir = async (currentPath, relativePrefix = '') => {
          let matches = [];
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            if (ignoreDirs.includes(entry.name)) continue;
            
            const relativePath = path.join(relativePrefix, entry.name);
            const fullPath = path.join(currentPath, entry.name);
            
            if (entry.isDirectory()) {
              try {
                const subMatches = await searchInDir(fullPath, relativePath);
                matches = matches.concat(subMatches);
              } catch {
                // Ignore subdirs we can't read
              }
            } else if (entry.isFile()) {
              try {
                // Check if file seems to be text
                const ext = path.extname(entry.name).toLowerCase();
                const textExtensions = ['.js', '.json', '.md', '.txt', '.html', '.css', '.ts', '.yml', '.yaml', '.sh', '.xml', '.ini', '.keep'];
                // Read anyway if no extension, or if it matches
                if (ext && !textExtensions.includes(ext)) continue;
                
                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split('\n');
                
                let regex;
                if (isRegex) {
                  regex = new RegExp(query, 'i');
                }
                
                lines.forEach((line, index) => {
                  const matched = isRegex ? regex.test(line) : line.toLowerCase().includes(query.toLowerCase());
                  if (matched) {
                    // Limit output length per match line
                    const cleanLine = line.trim();
                    matches.push({
                      filePath: relativePath,
                      lineNumber: index + 1,
                      lineContent: cleanLine.length > 150 ? cleanLine.slice(0, 150) + '...' : cleanLine
                    });
                  }
                });
              } catch {
                // Skip unreadable files
              }
            }
          }
          return matches;
        };
        
        const results = await searchInDir(targetPath);
        // Cap results to prevent context flooding
        const totalMatches = results.length;
        const cappedResults = results.slice(0, 100);
        const isTruncated = totalMatches > 100;
        
        return {
          success: true,
          query,
          totalMatches,
          isTruncated,
          matches: cappedResults,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  writeMarkdown: new FunctionTool({
    name: 'writeMarkdown',
    description: 'Create a new markdown file (.md) with structured, beautifully formatted sections.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative path of the markdown file to write (must end in .md)'),
      path: z.string().optional().describe('Alternative parameter name for filePath'),
      title: z.string().optional().describe('The main title of the markdown document'),
      sections: z.array(z.object({
        heading: z.string().describe('Section heading'),
        content: z.string().describe('Section text content (supports raw markdown)')
      })).optional().describe('An array of sections to build the document'),
    }),
    execute: async (args = {}) => {
      try {
        const filePath = args.filePath || args.path;
        if (!filePath) {
          return { success: false, error: 'Missing required parameter: filePath or path' };
        }
        const title = args.title || 'Untitled';
        const sections = args.sections || [];
        let finalPath = filePath;
        if (!finalPath.toLowerCase().endsWith('.md')) {
          finalPath = finalPath + '.md';
        }
        const targetPath = resolveSafePath(finalPath);
        
        let markdownContent = `# ${title}\n\n`;
        for (const section of sections) {
          markdownContent += `## ${section.heading}\n\n${section.content}\n\n`;
        }
        
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, markdownContent, 'utf-8');
        const stats = await fs.stat(targetPath);
        
        return {
          success: true,
          filePath: finalPath,
          sizeBytes: stats.size,
          message: `Successfully generated markdown document "${title}" at ${finalPath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  executeCommand: new FunctionTool({
    name: 'executeCommand',
    description: 'Execute a terminal command within the workspace directory. Useful for building, testing, or running workspace code.',
    parameters: z.object({
      command: z.string().describe('The shell command to execute, e.g. "npm run test" or "node index.js"'),
    }),
    execute: async ({ command }) => {
      const resolveCarriageReturnsLocal = (text) => {
        if (typeof text !== 'string') return text;
        const lines = text.split(/\r?\n/);
        const resolvedLines = lines.map(line => {
          if (line.includes('\r')) {
            const parts = line.split('\r');
            for (let i = parts.length - 1; i >= 0; i--) {
              if (parts[i].trim()) {
                return parts[i];
              }
            }
            return parts[parts.length - 1];
          }
          return line;
        });
        return resolvedLines.join('\n');
      };

      return new Promise((resolve) => {
        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
        const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
        
        const child = spawn(shell, args, { cwd: WORKSPACE_DIR });
        
        let stdout = '';
        let stderr = '';
        
        const isTTY = process.stdout.isTTY;
        let nonTtyStdoutBuffer = '';
        let nonTtyStderrBuffer = '';
        
        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          
          if (isTTY) {
            process.stdout.write(chunk);
          } else {
            nonTtyStdoutBuffer += chunk;
            const lines = nonTtyStdoutBuffer.split('\n');
            nonTtyStdoutBuffer = lines.pop(); // Keep partial line
            for (const line of lines) {
              const cleanLine = resolveCarriageReturnsLocal(line);
              process.stdout.write(cleanLine + '\n');
            }
          }
        });
        
        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          
          if (isTTY) {
            process.stderr.write(chunk);
          } else {
            nonTtyStderrBuffer += chunk;
            const lines = nonTtyStderrBuffer.split('\n');
            nonTtyStderrBuffer = lines.pop(); // Keep partial line
            for (const line of lines) {
              const cleanLine = resolveCarriageReturnsLocal(line);
              process.stderr.write(cleanLine + '\n');
            }
          }
        });
        
        child.on('error', (err) => {
          if (!isTTY) {
            if (nonTtyStdoutBuffer) {
              process.stdout.write(resolveCarriageReturnsLocal(nonTtyStdoutBuffer));
            }
            if (nonTtyStderrBuffer) {
              process.stderr.write(resolveCarriageReturnsLocal(nonTtyStderrBuffer));
            }
          }
          resolve({
            success: false,
            exitCode: -1,
            stdout,
            stderr: stderr + '\n' + err.message,
            message: `Failed to start process: ${err.message}\n\nOutput:\n${stdout}\n\nError:\n${stderr}`
          });
        });
        
        child.on('close', (code) => {
          if (!isTTY) {
            if (nonTtyStdoutBuffer) {
              process.stdout.write(resolveCarriageReturnsLocal(nonTtyStdoutBuffer) + '\n');
            }
            if (nonTtyStderrBuffer) {
              process.stderr.write(resolveCarriageReturnsLocal(nonTtyStderrBuffer) + '\n');
            }
          }
          resolve({
            success: code === 0,
            exitCode: code ?? 0,
            stdout,
            stderr,
            message: code === 0 
              ? `Command executed successfully.\n\nOutput:\n${stdout}` 
              : `Command failed with exit code ${code}.\n\nOutput:\n${stdout}\n\nError:\n${stderr}`
          });
        });
      });
    }
  }),

  searchReplace: new FunctionTool({
    name: 'searchReplace',
    description: 'Find and replace a specific string or pattern inside a file in the workspace.',
    parameters: z.object({
      filePath: z.string().describe('The relative path of the file to modify'),
      findText: z.string().describe('The exact text block to search for and replace'),
      replaceText: z.string().describe('The text block to replace the search match with'),
    }),
    execute: async ({ filePath, findText, replaceText }) => {
      try {
        const targetPath = resolveSafePath(filePath);
        const stats = await fs.stat(targetPath);
        if (!stats.isFile()) {
          return { success: false, error: 'The specified path is not a file.' };
        }
        const content = await fs.readFile(targetPath, 'utf-8');
        if (!content.includes(findText)) {
          return { success: false, error: `Could not find the target text block in file: ${filePath}. Match must be exact.` };
        }
        const updatedContent = content.replace(findText, replaceText);
        await fs.writeFile(targetPath, updatedContent, 'utf-8');
        return {
          success: true,
          filePath,
          message: `Successfully replaced the text block in ${filePath}`
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  findFiles: new FunctionTool({
    name: 'findFiles',
    description: 'Find files in the workspace matching a specific pattern or containing a substring in their name.',
    parameters: z.object({
      pattern: z.string().describe('The filename pattern or substring to search for (e.g., "*.js", "config", "index.html")'),
      directory: z.string().optional().describe('The relative directory to search within, defaults to workspace root "."'),
    }),
    execute: async ({ pattern, directory = '.' }) => {
      try {
        const targetPath = resolveSafePath(directory);
        const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json'];
        
        let isRegex = pattern.includes('*') || pattern.includes('?');
        let regexPattern = null;
        if (isRegex) {
          const escaped = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
          regexPattern = new RegExp(`^${escaped}$`, 'i');
        }

        const findInDir = async (currentPath, relativePrefix = '') => {
          let results = [];
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            if (ignoreDirs.includes(entry.name)) continue;
            const relativePath = path.join(relativePrefix, entry.name);
            const fullPath = path.join(currentPath, entry.name);
            
            if (entry.isDirectory()) {
              try {
                const subResults = await findInDir(fullPath, relativePath);
                results = results.concat(subResults);
              } catch {
                // skip unreadable
              }
            } else {
              const matchesPattern = regexPattern 
                ? regexPattern.test(entry.name) 
                : entry.name.toLowerCase().includes(pattern.toLowerCase());
                
              if (matchesPattern) {
                const stats = await fs.stat(fullPath);
                results.push({
                  filePath: relativePath,
                  sizeBytes: stats.size,
                  modifiedTime: stats.mtime
                });
              }
            }
          }
          return results;
        };

        const matches = await findInDir(targetPath);
        return {
          success: true,
          pattern,
          totalMatches: matches.length,
          matches: matches.slice(0, 100),
          isTruncated: matches.length > 100
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),
};
