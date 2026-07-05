import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import { exec } from 'child_process';
import crypto from 'crypto';
import { resolveSafePath, INSTALL_DIR } from './core-helper.js';

let dinoServer = null;
let dinoPort = 0;

export const systemTools = {
  calculator: new FunctionTool({
    name: 'calculator',
    description: 'Safely evaluate standard mathematical expressions. Supports addition (+), subtraction (-), multiplication (*), division (/), modulo (%), and parentheses.',
    parameters: z.object({
      expression: z.string().describe('The mathematical expression to evaluate, e.g. "2 * (3 + 4)"'),
    }),
    execute: async ({ expression }) => {
      try {
        // Sanitize the expression to ensure it only contains mathematical characters
        const sanitized = expression.replace(/[^0-9+\-*/%().\s]/g, '');
        if (sanitized !== expression) {
          return {
            success: false,
            error: 'Expression contains forbidden characters. Only numbers and standard operators are allowed.',
          };
        }
        // Evaluate the sanitized expression
        const result = new Function(`return (${sanitized});`)();
        return {
          success: true,
          expression,
          result: typeof result === 'number' ? Number(result.toFixed(6)) : result,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  getSystemInfo: new FunctionTool({
    name: 'getSystemInfo',
    description: 'Retrieve current local system information such as operating system, system uptime, and memory usage.',
    parameters: z.object({}),
    execute: async () => {
      try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        return {
          success: true,
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          uptimeHours: Number((os.uptime() / 3600).toFixed(2)),
          memory: {
            totalGB: Number((totalMem / 1024 / 1024 / 1024).toFixed(2)),
            usedGB: Number((usedMem / 1024 / 1024 / 1024).toFixed(2)),
            freeGB: Number((freeMem / 1024 / 1024 / 1024).toFixed(2)),
            percentUsed: Number(((usedMem / totalMem) * 100).toFixed(1)),
          },
          cpu: {
            model: os.cpus()[0]?.model || 'Unknown',
            cores: os.cpus().length,
          }
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  }),

  getCurrentTime: new FunctionTool({
    name: 'getCurrentTime',
    description: 'Get the current local date, time, and timezone offset on the host machine.',
    parameters: z.object({}),
    execute: async () => {
      const now = new Date();
      return {
        success: true,
        localTime: now.toString(),
        isoString: now.toISOString(),
        timestamp: now.getTime(),
        timezoneOffset: now.getTimezoneOffset(),
      };
    },
  }),

  dinoGame: new FunctionTool({
    name: 'dinoGame',
    description: 'Launch the premium Plumar Dino Game locally. Spins up an HTTP server and automatically opens the game in your web browser.',
    parameters: z.object({
      action: z.enum(['start', 'stop', 'status']).optional().default('start').describe('The action to perform: start the game server, stop it, or check status'),
    }),
    execute: async ({ action }) => {
      try {
        if (action === 'stop') {
          if (dinoServer) {
            dinoServer.close();
            dinoServer = null;
            dinoPort = 0;
            return { success: true, message: 'Plumar Dino game server stopped successfully.' };
          }
          return { success: true, message: 'Dino server was not running.' };
        }

        if (action === 'status') {
          return {
            success: true,
            running: !!dinoServer,
            url: dinoPort ? `http://localhost:${dinoPort}` : null,
            message: dinoServer 
              ? `Plumar Dino is active at http://localhost:${dinoPort}` 
              : 'Plumar Dino server is currently idle.'
          };
        }

        // Start the server if not already running
        if (!dinoServer) {
          const gameHtmlPath = path.join(INSTALL_DIR, 'dino-game', 'index.html');
          
          dinoServer = http.createServer(async (req, res) => {
            try {
              const content = await fs.readFile(gameHtmlPath, 'utf-8');
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(content);
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end(`Error loading game: ${err.message}`);
            }
          });

          await new Promise((resolve, reject) => {
            dinoServer.listen(3456, () => {
              dinoPort = 3456;
              resolve();
            });
            dinoServer.on('error', (err) => {
              if (err.code === 'EADDRINUSE') {
                dinoServer.listen(0, () => {
                  dinoPort = dinoServer.address().port;
                  resolve();
                });
              } else {
                reject(err);
              }
            });
          });
        }

        const url = `http://localhost:${dinoPort}`;
        
        const openCommand = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open');
        exec(`${openCommand} ${url}`, (err) => {
          // Ignore error, browser might not be available or opened, but we still return the URL
        });

        return {
          success: true,
          url,
          port: dinoPort,
          message: `👾 Plumar Dino Game is running!\n\n👉 Open this link in your browser to play: ${url}\n\nFeatures:\n• 🌟 Starfield Parallax Backdrop\n• 🎶 8-Bit Audio synthesizer (via Web Audio API)\n• 🌌 Multiple Physics Modes: Standard Gravity, Float Low Gravity, and Gravity Flip Mode!\n• 💾 High scores are persistent. Have fun!`
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  generateMockData: new FunctionTool({
    name: 'generateMockData',
    description: 'Generate structured mock/test data in JSON, CSV, XML, or YAML formats. Supports various presets (users, products, orders, transactions) or custom schema definitions.',
    parameters: z.object({
      preset: z.enum(['users', 'products', 'orders', 'transactions', 'custom']).default('users').describe('The preset type of data to generate.'),
      format: z.enum(['json', 'csv', 'xml', 'yaml']).default('json').describe('The output serialization format.'),
      count: z.number().int().min(1).max(500).default(10).describe('Number of mock items to generate (max 500).'),
      customFields: z.array(z.object({
        name: z.string().describe('The field name.'),
        type: z.enum(['id', 'uuid', 'name', 'email', 'phone', 'company', 'date', 'price', 'quantity', 'boolean', 'text']).describe('The field generator data type.'),
      })).optional().describe('Custom fields schema to use when preset is "custom".'),
      outputPath: z.string().optional().describe('Optional relative path inside the workspace to save the generated structured mock data directly.'),
    }),
    execute: async ({ preset = 'users', format = 'json', count = 10, customFields, outputPath }) => {
      try {
        const firstNames = ['John', 'Jane', 'Alex', 'Emily', 'Michael', 'Sarah', 'David', 'Jessica', 'James', 'Ashley', 'Robert', 'Megan', 'William', 'Amanda'];
        const lastNames = ['Smith', 'Doe', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson', 'Martinez', 'Anderson'];
        const companies = ['Stark Industries', 'Acme Corp', 'Initech', 'Hooli', 'Vehement Capital', 'Umbrella Corp', 'Cyberdyne Systems', 'Globex'];
        const products = ['Neon T-Rex Mug', 'Quantum Keyboard', 'Mechanical Retro Mouse', 'Cyberpunk Lamp', '8-Bit Synth Synthesizer', 'Low-G Skate Helmet', 'Astronaut Coffee beans'];
        const categories = ['Kitchen', 'Electronics', 'Peripherals', 'Home Decor', 'Audio', 'Apparel', 'Food'];

        const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const getRandomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
        const getRandomPrice = (min, max) => parseFloat((Math.random() * (max - min) + min).toFixed(2));
        const getRandomPhone = () => `+1 (${getRandomRange(200, 999)}) 555-${getRandomRange(1000, 9999)}`;

        const generateItem = (idx) => {
          if (preset === 'users') {
            const firstName = getRandomItem(firstNames);
            const lastName = getRandomItem(lastNames);
            return {
              id: idx + 1,
              uuid: crypto.randomUUID ? crypto.randomUUID() : `u-${Math.random().toString(36).substring(2, 11)}`,
              name: `${firstName} ${lastName}`,
              email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
              phone: getRandomPhone(),
              company: getRandomItem(companies),
              role: getRandomItem(['Admin', 'Developer', 'Designer', 'Product Manager', 'User']),
              active: Math.random() > 0.15,
              joinedDate: new Date(Date.now() - getRandomRange(1, 1000) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            };
          }

          if (preset === 'products') {
            return {
              id: idx + 1,
              sku: `PROD-${getRandomRange(1000, 9999)}-${idx + 100}`,
              name: getRandomItem(products),
              category: getRandomItem(categories),
              price: getRandomPrice(10, 500),
              stock: getRandomRange(0, 150),
              rating: parseFloat((Math.random() * 2 + 3).toFixed(1)),
              discontinued: Math.random() > 0.90
            };
          }

          if (preset === 'orders') {
            return {
              orderId: 10000 + idx,
              customerId: getRandomRange(1, 100),
              customerName: `${getRandomItem(firstNames)} ${getRandomItem(lastNames)}`,
              productName: getRandomItem(products),
              totalAmount: getRandomPrice(15, 1200),
              status: getRandomItem(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled']),
              orderDate: new Date(Date.now() - getRandomRange(0, 30) * 24 * 60 * 60 * 1000).toISOString()
            };
          }

          if (preset === 'transactions') {
            return {
              transactionId: `TXN-${Math.random().toString(36).substring(2, 11).toUpperCase()}`,
              amount: getRandomPrice(5, 5000),
              type: getRandomItem(['deposit', 'withdrawal', 'payment', 'refund']),
              status: getRandomItem(['success', 'pending', 'failed']),
              paymentMethod: getRandomItem(['Credit Card', 'PayPal', 'Crypto', 'Bank Transfer']),
              timestamp: new Date(Date.now() - getRandomRange(0, 60) * 60 * 1000).toISOString()
            };
          }

          // Custom Schema logic
          if (preset === 'custom' && customFields && customFields.length > 0) {
            const customItem = {};
            customFields.forEach(f => {
              switch (f.type) {
                case 'id':
                  customItem[f.name] = idx + 1;
                  break;
                case 'uuid':
                  customItem[f.name] = crypto.randomUUID ? crypto.randomUUID() : `uid-${Math.random().toString(36).substring(2, 11)}`;
                  break;
                case 'name':
                  customItem[f.name] = `${getRandomItem(firstNames)} ${getRandomItem(lastNames)}`;
                  break;
                case 'email':
                  customItem[f.name] = `${getRandomItem(firstNames).toLowerCase()}.${getRandomItem(lastNames).toLowerCase()}@example.com`;
                  break;
                case 'phone':
                  customItem[f.name] = getRandomPhone();
                  break;
                case 'company':
                  customItem[f.name] = getRandomItem(companies);
                  break;
                case 'date':
                  customItem[f.name] = new Date(Date.now() - getRandomRange(0, 365) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                  break;
                case 'price':
                  customItem[f.name] = getRandomPrice(5, 1000);
                  break;
                case 'quantity':
                  customItem[f.name] = getRandomRange(1, 50);
                  break;
                case 'boolean':
                  customItem[f.name] = Math.random() > 0.5;
                  break;
                case 'text':
                  customItem[f.name] = `Lorem ipsum dolor sit amet, consectetur adipiscing elit.`;
                  break;
                default:
                  customItem[f.name] = null;
              }
            });
            return customItem;
          }

          return { id: idx + 1, note: 'Default generic mock object' };
        };

        const dataList = Array.from({ length: count }, (_, idx) => generateItem(idx));
        let serializedData = '';

        if (format === 'json') {
          serializedData = JSON.stringify(dataList, null, 2);
        } else if (format === 'csv') {
          if (dataList.length > 0) {
            const headers = Object.keys(dataList[0]);
            const csvRows = [headers.join(',')];
            for (const item of dataList) {
              const row = headers.map(header => {
                const val = item[header];
                if (val === null || val === undefined) return '';
                const str = String(val);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                  return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
              });
              csvRows.push(row.join(','));
            }
            serializedData = csvRows.join('\n');
          }
        } else if (format === 'xml') {
          const xmlLines = ['<?xml version="1.0" encoding="UTF-8"?>', `<records>`];
          const rootTagName = preset === 'custom' ? 'record' : preset.slice(0, -1) || 'item';
          for (const item of dataList) {
            xmlLines.push(`  <${rootTagName}>`);
            for (const [key, val] of Object.entries(item)) {
              xmlLines.push(`    <${key}>${val}</${key}>`);
            }
            xmlLines.push(`  </${rootTagName}>`);
          }
          xmlLines.push('</records>');
          serializedData = xmlLines.join('\n');
        } else if (format === 'yaml') {
          const yamlLines = [];
          for (const item of dataList) {
            yamlLines.push('-');
            for (const [key, val] of Object.entries(item)) {
              if (typeof val === 'object' && val !== null) {
                yamlLines.push(`  ${key}: ${JSON.stringify(val)}`);
              } else if (typeof val === 'string' && (val.includes(':') || val.includes('#') || val.includes('\n'))) {
                yamlLines.push(`  ${key}: "${val.replace(/"/g, '\\"')}"`);
              } else {
                yamlLines.push(`  ${key}: ${val}`);
              }
            }
          }
          serializedData = yamlLines.join('\n');
        }

        let savedMessage = '';
        if (outputPath) {
          const targetPath = resolveSafePath(outputPath);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, serializedData, 'utf-8');
          savedMessage = ` Mock data successfully saved to "${outputPath}".`;
        }

        return {
          success: true,
          preset,
          format,
          count,
          message: `Successfully generated structured mock data.${savedMessage}`,
          data: count > 20 ? serializedData.split('\n').slice(0, 50).join('\n') + '\n... [TRUNCATED] ...' : serializedData
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  generateHash: new FunctionTool({
    name: 'generateHash',
    description: 'Calculate cryptographic hash values (MD5, SHA-1, SHA-256, SHA-512) for strings or files in the workspace.',
    parameters: z.object({
      algorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']).default('sha256').describe('The hashing algorithm to use.'),
      inputType: z.enum(['text', 'file']).default('text').describe('The type of input being hashed: "text" (a raw string) or "file" (relative path to a workspace file).'),
      input: z.string().describe('The raw text to hash, or the relative path of the file to hash.'),
      encoding: z.enum(['hex', 'base64', 'latin1']).default('hex').describe('The output digest encoding.'),
    }),
    execute: async ({ algorithm = 'sha256', inputType = 'text', input, encoding = 'hex' }) => {
      try {
        const hash = crypto.createHash(algorithm);
        
        if (inputType === 'file') {
          const resolvedPath = resolveSafePath(input);
          const data = await fs.readFile(resolvedPath);
          hash.update(data);
        } else {
          hash.update(input, 'utf-8');
        }

        const digest = hash.digest(encoding);
        return {
          success: true,
          algorithm,
          inputType,
          encoding,
          hash: digest
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),
};
