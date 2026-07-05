import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { resolveSafePath, WORKSPACE_DIR } from './core-helper.js';

export const developmentTools = {
  portManager: new FunctionTool({
    name: 'portManager',
    description: 'Query processes running on a specific port or terminate a process by port number or PID.',
    parameters: z.object({
      action: z.enum(['list', 'kill']).describe('Whether to list processes or kill a process.'),
      port: z.number().int().optional().describe('The port number to query or kill processes on (e.g. 3000).'),
      pid: z.number().int().optional().describe('Direct process ID to kill (required for "kill" if no port is specified).')
    }),
    execute: async ({ action, port, pid }) => {
      try {
        if (action === 'list') {
          if (!port) {
            throw new Error('Port is required for "list" action.');
          }
          return new Promise((resolve) => {
            exec(`lsof -i :${port} -F pcu`, (err, stdout) => {
              if (err || !stdout) {
                return resolve({
                  success: true,
                  message: `No active processes found on port ${port}.`,
                  processes: []
                });
              }
              const lines = stdout.trim().split('\n');
              const processes = [];
              let currentProc = {};
              for (const line of lines) {
                if (line.startsWith('p')) {
                  if (currentProc.pid) processes.push(currentProc);
                  currentProc = { pid: parseInt(line.slice(1)) };
                } else if (line.startsWith('c')) {
                  currentProc.command = line.slice(1);
                } else if (line.startsWith('u')) {
                  currentProc.uid = line.slice(1);
                }
              }
              if (currentProc.pid) processes.push(currentProc);
              resolve({
                success: true,
                message: `Found ${processes.length} process(es) running on port ${port}.`,
                processes
              });
            });
          });
        } else {
          let targetPid = pid;
          if (!targetPid && port) {
            const pids = await new Promise((resolve) => {
              exec(`lsof -t -i :${port}`, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                resolve(stdout.trim().split('\n').map(p => parseInt(p)).filter(Boolean));
              });
            });
            if (pids.length === 0) {
              return { success: false, error: `No process found on port ${port}.` };
            }
            targetPid = pids[0];
          }

          if (!targetPid) {
            throw new Error('Either port or pid must be specified to kill a process.');
          }

          process.kill(targetPid, 'SIGKILL');
          return {
            success: true,
            message: `Successfully sent SIGKILL to process ${targetPid}.`
          };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  regexHelper: new FunctionTool({
    name: 'regexHelper',
    description: 'Evaluate regular expressions to test, match, or replace text strings.',
    parameters: z.object({
      action: z.enum(['test', 'match', 'replace']).describe('The regular expression action to perform.'),
      pattern: z.string().describe('The regular expression pattern string (without slashes).'),
      flags: z.string().optional().default('g').describe('Regular expression flags (e.g. "g", "i", "m", "gi").'),
      text: z.string().describe('The input text string to apply the regular expression to.'),
      replacement: z.string().optional().describe('The replacement string (required for "replace" action).')
    }),
    execute: async ({ action, pattern, flags = 'g', text, replacement }) => {
      try {
        const regex = new RegExp(pattern, flags);
        if (action === 'test') {
          const matched = regex.test(text);
          return { success: true, matched };
        } else if (action === 'match') {
          const matches = [];
          if (flags.includes('g')) {
            let match;
            while ((match = regex.exec(text)) !== null) {
              matches.push({
                match: match[0],
                index: match.index,
                groups: match.slice(1)
              });
            }
          } else {
            const match = text.match(regex);
            if (match) {
              matches.push({
                match: match[0],
                index: match.index,
                groups: match.slice(1)
              });
            }
          }
          return { success: true, count: matches.length, matches };
        } else {
          if (replacement === undefined) {
            throw new Error('Replacement string is required for "replace" action.');
          }
          const result = text.replace(regex, replacement);
          return { success: true, result };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  codeFormatter: new FunctionTool({
    name: 'codeFormatter',
    description: 'Format or lint a code file using the appropriate language-specific formatter or linter CLI tool (such as Prettier/ESLint for web/JS, black/pylint for Python, gofmt/govet for Go, rustfmt/clippy for Rust, clang-format for C++/Java/C#, rubocop for Ruby, etc.).',
    parameters: z.object({
      filePath: z.string().describe('The absolute or relative path to the file inside the workspace.'),
      action: z.enum(['format', 'lint']).optional().default('format').describe('The action to perform: "format" (reformat code) or "lint" (check style and correctness).')
    }),
    execute: async ({ filePath, action = 'format' }) => {
      try {
        const resolvedPath = resolveSafePath(filePath);
        const ext = path.extname(resolvedPath).toLowerCase();
        let cmd = '';

        if (action === 'format') {
          if (['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.sass', '.less', '.yaml', '.yml', '.md'].includes(ext)) {
            cmd = `npx prettier --write "${resolvedPath}"`;
          } else if (['.py'].includes(ext)) {
            cmd = `black "${resolvedPath}" || autopep8 --in-place "${resolvedPath}" || python3 -m black "${resolvedPath}"`;
          } else if (['.go'].includes(ext)) {
            cmd = `gofmt -w "${resolvedPath}"`;
          } else if (['.rs'].includes(ext)) {
            cmd = `rustfmt "${resolvedPath}"`;
          } else if (['.cpp', '.hpp', '.cc', '.cxx', '.h', '.c', '.m', '.mm'].includes(ext)) {
            cmd = `clang-format -i "${resolvedPath}"`;
          } else if (['.java'].includes(ext)) {
            cmd = `google-java-format -i "${resolvedPath}" || clang-format -i "${resolvedPath}"`;
          } else if (['.cs'].includes(ext)) {
            cmd = `dotnet-format "${resolvedPath}" || clang-format -i "${resolvedPath}"`;
          } else if (['.rb'].includes(ext)) {
            cmd = `rubocop -a "${resolvedPath}"`;
          } else if (['.php'].includes(ext)) {
            cmd = `php-cs-fixer fix "${resolvedPath}" || phpcbf "${resolvedPath}"`;
          } else if (['.swift'].includes(ext)) {
            cmd = `swiftformat "${resolvedPath}" || swift-format -i "${resolvedPath}"`;
          } else if (['.kt', '.kts'].includes(ext)) {
            cmd = `ktlint -F "${resolvedPath}"`;
          } else if (['.dart'].includes(ext)) {
            cmd = `dart format "${resolvedPath}"`;
          } else if (['.sh', '.bash', '.zsh'].includes(ext)) {
            cmd = `shfmt -w "${resolvedPath}"`;
          } else if (['.lua'].includes(ext)) {
            cmd = `stylua "${resolvedPath}" || lua-format -i "${resolvedPath}"`;
          } else if (['.pl', '.pm'].includes(ext)) {
            cmd = `perltidy -b "${resolvedPath}"`;
          } else if (['.r', '.R'].includes(ext)) {
            cmd = `Rscript -e "styler::style_file('${resolvedPath}')"`;
          } else if (['.hs', '.lhs'].includes(ext)) {
            cmd = `hindent "${resolvedPath}" || ormolu --mode inplace "${resolvedPath}" || brittany --inplace "${resolvedPath}"`;
          } else if (['.ex', '.exs'].includes(ext)) {
            cmd = `mix format "${resolvedPath}"`;
          } else if (['.sql'].includes(ext)) {
            cmd = `npx sql-formatter --fix "${resolvedPath}"`;
          } else if (['.xml'].includes(ext)) {
            cmd = `xmllint --format --output "${resolvedPath}" "${resolvedPath}"`;
          } else if (['.clj', '.cljs', '.cljc', '.edn'].includes(ext)) {
            cmd = `cljstyle fix "${resolvedPath}"`;
          } else if (['.fs', '.fsi', '.fsx'].includes(ext)) {
            cmd = `fantomas "${resolvedPath}"`;
          } else if (['.groovy', '.gvy', '.gy', '.gsh'].includes(ext)) {
            cmd = `npm-groovy-lint --format "${resolvedPath}"`;
          } else {
            // General fallback
            cmd = `npx prettier --write "${resolvedPath}"`;
          }
        } else { // action === 'lint'
          if (['.js', '.jsx', '.ts', '.tsx', '.json'].includes(ext)) {
            cmd = `npx eslint --fix "${resolvedPath}"`;
          } else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
            cmd = `npx stylelint --fix "${resolvedPath}"`;
          } else if (['.html'].includes(ext)) {
            cmd = `npx htmlhint "${resolvedPath}" || htmlhint "${resolvedPath}"`;
          } else if (['.md'].includes(ext)) {
            cmd = `npx markdownlint "${resolvedPath}" || markdownlint "${resolvedPath}"`;
          } else if (['.yaml', '.yml'].includes(ext)) {
            cmd = `yamllint "${resolvedPath}"`;
          } else if (['.py'].includes(ext)) {
            cmd = `pylint "${resolvedPath}" || flake8 "${resolvedPath}" || python3 -m pylint "${resolvedPath}"`;
          } else if (['.go'].includes(ext)) {
            cmd = `go vet "${resolvedPath}" || golangci-lint run "${resolvedPath}"`;
          } else if (['.rs'].includes(ext)) {
            cmd = `cargo clippy --fix --allow-dirty --allow-staged || cargo check`;
          } else if (['.cpp', '.hpp', '.cc', '.cxx', '.h', '.c', '.m', '.mm'].includes(ext)) {
            cmd = `cppcheck "${resolvedPath}" || clang-tidy "${resolvedPath}"`;
          } else if (['.java'].includes(ext)) {
            cmd = `checkstyle "${resolvedPath}" || javac -Xlint "${resolvedPath}"`;
          } else if (['.cs'].includes(ext)) {
            cmd = `dotnet format --verify-no-changes "${resolvedPath}"`;
          } else if (['.rb'].includes(ext)) {
            cmd = `rubocop "${resolvedPath}"`;
          } else if (['.php'].includes(ext)) {
            cmd = `php -l "${resolvedPath}"`;
          } else if (['.swift'].includes(ext)) {
            cmd = `swiftlint "${resolvedPath}" || swift-format lint "${resolvedPath}"`;
          } else if (['.kt', '.kts'].includes(ext)) {
            cmd = `ktlint "${resolvedPath}"`;
          } else if (['.dart'].includes(ext)) {
            cmd = `dart analyze "${resolvedPath}"`;
          } else if (['.sh', '.bash', '.zsh'].includes(ext)) {
            cmd = `shellcheck "${resolvedPath}"`;
          } else if (['.lua'].includes(ext)) {
            cmd = `luacheck "${resolvedPath}"`;
          } else if (['.pl', '.pm'].includes(ext)) {
            cmd = `perl -c "${resolvedPath}"`;
          } else if (['.r', '.R'].includes(ext)) {
            cmd = `Rscript -e "lintr::lint('${resolvedPath}')"`;
          } else if (['.hs', '.lhs'].includes(ext)) {
            cmd = `hlint "${resolvedPath}"`;
          } else if (['.ex', '.exs'].includes(ext)) {
            cmd = `mix credo "${resolvedPath}"`;
          } else if (['.sql'].includes(ext)) {
            cmd = `sqlfluff lint "${resolvedPath}"`;
          } else if (['.xml'].includes(ext)) {
            cmd = `xmllint --noout "${resolvedPath}"`;
          } else if (['.clj', '.cljs', '.cljc', '.edn'].includes(ext)) {
            cmd = `clj-kondo --lint "${resolvedPath}"`;
          } else if (['.groovy', '.gvy', '.gy', '.gsh'].includes(ext)) {
            cmd = `npm-groovy-lint "${resolvedPath}"`;
          } else {
            // General fallback
            cmd = `npx eslint --fix "${resolvedPath}"`;
          }
        }

        return new Promise((resolve) => {
          exec(cmd, (err, stdout, stderr) => {
            const errStr = ((stderr || '') + (stdout || '') + (err ? err.message : '')).toLowerCase();
            if (err) {
              const isNotFound = errStr.includes('not found') || 
                                 errStr.includes('could not be found') || 
                                 errStr.includes('err_pnpm_') ||
                                 errStr.includes('configurationerror') ||
                                 errStr.includes('no configuration') ||
                                 errStr.includes('no config') ||
                                 errStr.includes('failed to load') ||
                                 errStr.includes('cannot find module') ||
                                 errStr.includes('npm err!') ||
                                 errStr.includes('npm error') ||
                                 errStr.includes('nofilesfounderror') ||
                                 errStr.includes('not recognized') ||
                                 errStr.includes('permission denied') ||
                                 errStr.includes('no module named') ||
                                 errStr.includes('cargo.toml') ||
                                 err.code === 127;
              if (isNotFound) {
                return resolve({
                  success: true,
                  message: `Notice: '${action}' tool for extension '${ext}' is not installed or configured in the workspace. Command attempted: ${cmd}`,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  fallbackUsed: true
                });
              }
              return resolve({
                success: false,
                error: `Command failed: ${cmd}\nStderr: ${stderr.trim() || stderr || err.message}`
              });
            }
            resolve({
              success: true,
              message: `Successfully performed ${action} on ${filePath}.`,
              stdout: stdout.trim()
            });
          });
        });
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  dependencyScanner: new FunctionTool({
    name: 'dependencyScanner',
    description: 'Scan workspace files to find imported package dependencies, compare them with package.json, and audit outdated NPM packages.',
    parameters: z.object({
      action: z.enum(['scanImports', 'checkOutdated', 'audit']).optional().default('scanImports').describe('The dependency scan action to run.')
    }),
    execute: async ({ action = 'scanImports' }) => {
      try {
        if (action === 'scanImports') {
          const packageJsonPath = path.join(WORKSPACE_DIR, 'package.json');
          const packageJsonExists = await fs.stat(packageJsonPath).then(() => true).catch(() => false);
          if (!packageJsonExists) {
            throw new Error('package.json not found in the workspace root.');
          }
          const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          const declaredDeps = new Set([
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {})
          ]);

          const walkDir = async (dir, fileList = []) => {
            const files = await fs.readdir(dir);
            for (const file of files) {
              if (['node_modules', '.git', '.antigravitycli', 'dist', 'build'].includes(file)) continue;
              const p = path.join(dir, file);
              const stat = await fs.stat(p);
              if (stat.isDirectory()) {
                await walkDir(p, fileList);
              } else if (stat.isFile() && /\.(js|ts|jsx|tsx|mjs|cjs)$/.test(file)) {
                fileList.push(p);
              }
            }
            return fileList;
          };

          const files = await walkDir(WORKSPACE_DIR);
          const usedDeps = new Set();
          const importRegex = /(?:import\s+(?:[\w\s{},*]*\s+from\s+)?['"]([^'"]+)['"])|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

          for (const file of files) {
            const content = await fs.readFile(file, 'utf-8');
            let match;
            while ((match = importRegex.exec(content)) !== null) {
              const specifier = match[1] || match[2];
              if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/') && !path.isAbsolute(specifier)) {
                const parts = specifier.split('/');
                const pkgName = specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
                const builtins = ['path', 'fs', 'os', 'child_process', 'crypto', 'http', 'https', 'util', 'url', 'querystring', 'events', 'stream', 'assert'];
                if (!builtins.includes(pkgName)) {
                  usedDeps.add(pkgName);
                }
              }
            }
          }

          const missing = [...usedDeps].filter(d => !declaredDeps.has(d));
          const unused = [...declaredDeps].filter(d => !usedDeps.has(d) && d !== pkg.name);

          return {
            success: true,
            declaredDependencies: [...declaredDeps],
            usedDependencies: [...usedDeps],
            missingDependencies: missing,
            unusedDependencies: unused,
            message: `Scanned ${files.length} code files. Found ${missing.length} missing and ${unused.length} unused packages.`
          };
        } else {
          const cmd = action === 'checkOutdated' ? 'npm outdated --json' : 'npm audit --json';
          return new Promise((resolve) => {
            exec(cmd, (err, stdout) => {
              try {
                const parsed = stdout ? JSON.parse(stdout) : {};
                resolve({
                  success: true,
                  action,
                  data: parsed
                });
              } catch {
                resolve({
                  success: true,
                  action,
                  rawOutput: stdout.trim() || 'No packages found.'
                });
              }
            });
          });
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  gitHelper: new FunctionTool({
    name: 'gitHelper',
    description: 'Inspect git repository status, diffs, logs, and automatically draft descriptive git commit messages.',
    parameters: z.object({
      action: z.enum(['status', 'diff', 'log', 'draftCommitMessage']).optional().default('status').describe('The git query action to run.')
    }),
    execute: async ({ action = 'status' }) => {
      try {
        const runGit = (args) => {
          return new Promise((resolve, reject) => {
            exec(`git ${args}`, (err, stdout, stderr) => {
              if (err && !stdout) {
                const error = new Error(stderr.trim() || err.message);
                if (error.message.includes('not a git repository')) {
                  error.code = 'ENOTGIT';
                }
                return reject(error);
              }
              resolve(stdout.trim());
            });
          });
        };

        try {
          await runGit('rev-parse --is-inside-work-tree');
        } catch (err) {
          if (err.code === 'ENOTGIT' || err.message.includes('not a git repository')) {
            return {
              success: true,
              isGitRepository: false,
              message: 'Notice: The current workspace is not a Git repository. Run "git init" to enable.'
            };
          }
          throw err;
        }

        if (action === 'status') {
          const statusOutput = await runGit('status --porcelain');
          const lines = statusOutput ? statusOutput.split('\n') : [];
          const files = lines.map(line => {
            const code = line.slice(0, 2);
            const name = line.slice(3);
            return { code, name };
          });
          return {
            success: true,
            status: statusOutput,
            files
          };
        } else if (action === 'diff') {
          const diffOutput = await runGit('diff --stat');
          const fullDiff = await runGit('diff -U3');
          return {
            success: true,
            stat: diffOutput,
            diff: fullDiff.slice(0, 10000)
          };
        } else if (action === 'log') {
          const logOutput = await runGit('log -n 5 --oneline');
          return {
            success: true,
            log: logOutput.split('\n')
          };
        } else {
          const statusOutput = await runGit('status --porcelain');
          if (!statusOutput) {
            return {
              success: true,
              message: 'No changes found in the repository. Git status is clean.',
              draft: ''
            };
          }
          const diffOutput = await runGit('diff --stat');
          const fullDiff = await runGit('diff -U1');
          
          let draft = 'feat: update files\n\n- Updated workspace components';
          const lines = statusOutput.split('\n');
          const filesAdded = [];
          const filesModified = [];
          const filesDeleted = [];
          
          for (const line of lines) {
            const code = line.slice(0, 2).trim();
            const name = line.slice(3);
            if (code === '??' || code === 'A') filesAdded.push(name);
            else if (code === 'M') filesModified.push(name);
            else if (code === 'D') filesDeleted.push(name);
          }

          let subject = 'chore: update workspace';
          if (filesAdded.length > 0 && filesModified.length === 0) {
            subject = `feat: add ${path.basename(filesAdded[0])}`;
          } else if (filesModified.length === 1) {
            subject = `refactor: modify ${path.basename(filesModified[0])}`;
          } else if (filesModified.length > 1) {
            subject = `refactor: update ${filesModified.length} files`;
          }

          const bodyParts = [];
          if (filesAdded.length > 0) bodyParts.push(`Added files:\n${filesAdded.map(f => `  - ${f}`).join('\n')}`);
          if (filesModified.length > 0) bodyParts.push(`Modified files:\n${filesModified.map(f => `  - ${f}`).join('\n')}`);
          if (filesDeleted.length > 0) bodyParts.push(`Deleted files:\n${filesDeleted.map(f => `  - ${f}`).join('\n')}`);

          draft = `${subject}\n\n${bodyParts.join('\n\n')}`;
          return {
            success: true,
            message: 'Drafted commit message successfully based on git status.',
            draft
          };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  dbExplorer: new FunctionTool({
    name: 'dbExplorer',
    description: 'Inspect schemas and run custom queries on PostgreSQL and MySQL databases.',
    parameters: z.object({
      connectionUri: z.string().describe('The database connection URI string (e.g. "postgres://user:pass@localhost:5432/dbname" or "mysql://user:pass@localhost:3306/dbname").'),
      action: z.enum(['schema', 'query']).describe('The inspection action: "schema" to explore tables/columns or "query" to execute custom SQL.'),
      sql: z.string().optional().describe('The custom SQL query to execute (required for "query" action).')
    }),
    execute: async ({ connectionUri, action, sql }) => {
      try {
        const isPostgres = connectionUri.startsWith('postgres://') || connectionUri.startsWith('postgresql://');
        const isMysql = connectionUri.startsWith('mysql://');

        if (!isPostgres && !isMysql) {
          throw new Error('Unsupported database protocol. Connection URI must start with postgres://, postgresql://, or mysql://');
        }

        if (action === 'query' && !sql) {
          throw new Error('SQL query parameter is required for "query" action.');
        }

        const runPsql = (query) => {
          return new Promise((resolve) => {
            const escapedQuery = query.replace(/"/g, '\\"').replace(/`/g, '\\`');
            const cmd = `psql "${connectionUri}" -A -F ',' -c "${escapedQuery}"`;
            exec(cmd, (err, stdout, stderr) => {
              if (err) {
                return resolve({
                  success: false,
                  error: `PostgreSQL query execution failed.\nCommand: ${cmd}\nStderr: ${stderr.trim()}`
                });
              }
              const lines = stdout.trim().split('\n');
              if (lines.length === 0 || !lines[0]) {
                return resolve({ success: true, rows: [] });
              }
              const headers = lines[0].split(',');
              const rows = lines.slice(1).map(line => {
                const values = line.split(',');
                const row = {};
                headers.forEach((h, idx) => {
                  row[h] = values[idx];
                });
                return row;
              });
              resolve({ success: true, headers, rows });
            });
          });
        };

        const runMysql = (query) => {
          return new Promise((resolve) => {
            const escapedQuery = query.replace(/"/g, '\\"').replace(/`/g, '\\`');
            let cmd;
            try {
              const url = new URL(connectionUri);
              const host = url.hostname || 'localhost';
              const port = url.port || '3306';
              const user = url.username || 'root';
              const password = url.password ? `-p"${url.password}"` : '';
              const database = url.pathname ? url.pathname.replace(/^\//, '') : '';
              cmd = `mysql -h "${host}" -P ${port} -u "${user}" ${password} ${database ? `-D "${database}"` : ''} -B -N -e "${escapedQuery}"`;
            } catch {
              cmd = `mysql "${connectionUri}" -B -N -e "${escapedQuery}"`;
            }

            exec(cmd, (err, stdout, stderr) => {
              if (err) {
                return resolve({
                  success: false,
                  error: `MySQL query execution failed.\nCommand: ${cmd}\nStderr: ${stderr.trim()}`
                });
              }
              const lines = stdout.trim().split('\n');
              const rows = lines.map(line => line.split('\t'));
              resolve({ success: true, rawRows: rows });
            });
          });
        };

        if (isPostgres) {
          if (action === 'schema') {
            const tablesQuery = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;`;
            const columnsQuery = `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;`;
            
            const tablesRes = await runPsql(tablesQuery);
            if (!tablesRes.success) return tablesRes;

            const columnsRes = await runPsql(columnsQuery);
            if (!columnsRes.success) return columnsRes;

            return {
              success: true,
              type: 'postgresql',
              tables: tablesRes.rows,
              columns: columnsRes.rows
            };
          } else {
            return await runPsql(sql);
          }
        } else {
          if (action === 'schema') {
            const tablesRes = await runMysql('SHOW TABLES;');
            if (!tablesRes.success) return tablesRes;

            const tables = (tablesRes.rawRows || []).map(r => r[0]).filter(Boolean);
            const schemaDetails = [];

            for (const table of tables) {
              const descRes = await runMysql(`DESCRIBE \`${table}\`;`);
              if (descRes.success) {
                schemaDetails.push({
                  table,
                  columns: (descRes.rawRows || []).map(row => ({
                    field: row[0],
                    type: row[1],
                    null: row[2],
                    key: row[3],
                    default: row[4],
                    extra: row[5]
                  }))
                });
              }
            }

            return {
              success: true,
              type: 'mysql',
              tables,
              schema: schemaDetails
            };
          } else {
            return await runMysql(sql);
          }
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  codeFixer: new FunctionTool({
    name: 'codeFixer',
    description: 'High-performance, multi-language code fixer tool. Supports multi-line search & replace, insertion anchors, escape sequence unescaping, line-range targeting, whole-file overwriting, appending, dry-run simulations, and automatic formatting/linting fallback.',
    parameters: z.object({
      filePath: z.string().optional().describe('The relative or absolute path of the file to modify inside the workspace.'),
      operations: z.array(z.object({
        action: z.enum(['replace', 'insert_before', 'insert_after', 'write', 'append']).describe('The action to perform on the target file section.'),
        search: z.string().optional().describe('The code block or pattern to match. Optional for "replace", "insert_before", or "insert_after"; if omitted, the entire targeted section (anchors/lines/file) is used as the match.'),
        replace: z.string().optional().describe('The replacement code content (required for "replace").'),
        content: z.string().optional().describe('The content to write, append, or insert.'),
        startAnchor: z.string().optional().describe('An optional start delimiter/string anchor. If provided, the modification is isolated to only occur AFTER this string.'),
        endAnchor: z.string().optional().describe('An optional end delimiter/string anchor. If provided, the modification is isolated to only occur BEFORE this string.'),
        startLine: z.number().optional().describe('1-indexed starting line number to restrict the scope of the search/replace.'),
        endLine: z.number().optional().describe('1-indexed ending line number to restrict the scope of the search/replace.'),
        isRegex: z.boolean().optional().default(false).describe('If true, search is evaluated as a regular expression.'),
        regexFlags: z.string().optional().default('g').describe('Regular expression flags if isRegex is true (e.g., "g", "i", "m").'),
        unescape: z.boolean().optional().default(true).describe('If true, decodes escaped characters like \\n, \\t, and \\\\ in parameters.')
      })).optional().describe('An ordered array of code modification operations to execute sequentially.'),
      files: z.array(z.string()).optional().describe('Optional list of files for scanning or propagating changes.'),
      correlate: z.object({
        files: z.array(z.string()).optional().describe('Optional list of files to scan for correlations. Defaults to root files or workspace files.'),
        targets: z.array(z.string()).optional().describe('Optional list of specific class/function names to correlate.')
      }).optional().describe('Cross-reference classes and functions across specified files.'),
      propagateCorrelations: z.array(z.object({
        search: z.string().describe('The name of the class or function to find.'),
        replace: z.string().describe('The new name or content to replace it with.'),
        files: z.array(z.string()).optional().describe('Files to apply this propagation to. Defaults to root files or all workspace files.')
      })).optional().describe('Rename/modify a class or function and automatically update both its definition and all of its reference sites.'),
      searchFunctionality: z.object({
        query: z.string().describe('A text keyword or regex pattern to search for in definitions, comments, or function bodies.'),
        files: z.array(z.string()).optional().describe('Optional list of files to restrict the search to.'),
        includeComments: z.boolean().optional().default(true).describe('If true, includes code comments and documentation in the search scope.'),
        includeDefinitionsOnly: z.boolean().optional().default(false).describe('If true, restricts matches to class/function/mixin definitions only.')
      }).optional().describe('Search for specific functionalities, keywords, patterns, or definitions in the workspace code.'),
      lintAndFormat: z.boolean().optional().default(true).describe('If true, runs Prettier formatting on the files after modifications.'),
      dryRun: z.boolean().optional().default(false).describe('If true, simulates the changes and returns a diff without modifying files.')
    }),
    execute: async (args) => {
      const {
        filePath,
        operations,
        files,
        correlate,
        propagateCorrelations,
        searchFunctionality,
        lintAndFormat = true,
        dryRun = false
      } = args;

      try {
        const fileContents = {}; // relativePath -> string
        const originalContents = {}; // relativePath -> string
        const modifiedFiles = new Set();

        const loadFile = async (relPath) => {
          const resolved = resolveSafePath(relPath);
          if (fileContents[relPath] !== undefined) {
            return fileContents[relPath];
          }
          try {
            const content = await fs.readFile(resolved, 'utf-8');
            fileContents[relPath] = content;
            originalContents[relPath] = content;
            return content;
          } catch (err) {
            fileContents[relPath] = '';
            originalContents[relPath] = '';
            return '';
          }
        };

        const getWorkspaceFiles = async () => {
          const ignoreDirs = ['node_modules', '.git', '.antigravitycli', '.gemini', 'package-lock.json', 'dist', 'build'];
          const listDirRecursive = async (currentPath, relativePrefix = '') => {
            let results = [];
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
              if (ignoreDirs.includes(entry.name)) continue;
              
              const relativePath = path.join(relativePrefix, entry.name);
              const fullPath = path.join(currentPath, entry.name);
              if (entry.isDirectory()) {
                try {
                  const subResults = await listDirRecursive(fullPath, relativePath);
                  results = results.concat(subResults);
                } catch {
                  // Ignore subdirs we can't read
                }
              } else {
                const ext = path.extname(entry.name).toLowerCase();
                const codeExtensions = [
                  '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.cpp', '.hpp', '.h', '.cc', '.cxx', '.c',
                  '.java', '.cs', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.scala', '.sh', '.bash',
                  '.dart', '.lua', '.pl', '.pm', '.r', '.hs', '.ex', '.exs', '.clj', '.cljs', '.jl', '.sql',
                  '.md', '.json', '.html', '.css', '.scss', '.sass', '.less'
                ];
                if (codeExtensions.includes(ext) || ext === '') {
                  results.push(relativePath);
                }
              }
            }
            return results;
          };
          return await listDirRecursive(WORKSPACE_DIR);
        };

        const unescapeString = (str) => {
          if (typeof str !== 'string') return str;
          return str
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'");
        };

        const escapeRegExp = (str) => {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        const generateUnifiedDiff = (original, modified) => {
          const origLines = original.split('\n');
          const modLines = modified.split('\n');
          
          const diffLines = [];
          let i = 0, j = 0;
          
          while (i < origLines.length || j < modLines.length) {
            if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
              diffLines.push({ type: 'common', line: origLines[i], origNo: i + 1, modNo: j + 1 });
              i++;
              j++;
            } else {
              let isDelete = false;
              let isInsert = false;
              
              let lookahead = 1;
              const maxLookahead = 20;
              let foundMatch = false;
              while (lookahead < maxLookahead && (i + lookahead < origLines.length || j + lookahead < modLines.length)) {
                if (i + lookahead < origLines.length && origLines[i + lookahead] === modLines[j]) {
                  isDelete = true;
                  foundMatch = true;
                  break;
                }
                if (j + lookahead < modLines.length && origLines[i] === modLines[j + lookahead]) {
                  isInsert = true;
                  foundMatch = true;
                  break;
                }
                lookahead++;
              }
              
              if (foundMatch) {
                if (isDelete) {
                  while (lookahead > 0) {
                    diffLines.push({ type: 'del', line: origLines[i], origNo: i + 1 });
                    i++;
                    lookahead--;
                  }
                } else if (isInsert) {
                  while (lookahead > 0) {
                    diffLines.push({ type: 'add', line: modLines[j], modNo: j + 1 });
                    j++;
                    lookahead--;
                  }
                }
              } else {
                if (i < origLines.length && j < modLines.length) {
                  diffLines.push({ type: 'del', line: origLines[i], origNo: i + 1 });
                  diffLines.push({ type: 'add', line: modLines[j], modNo: j + 1 });
                  i++;
                  j++;
                } else if (i < origLines.length) {
                  diffLines.push({ type: 'del', line: origLines[i], origNo: i + 1 });
                  i++;
                } else if (j < modLines.length) {
                  diffLines.push({ type: 'add', line: modLines[j], modNo: j + 1 });
                  j++;
                }
              }
            }
          }
          
          const formattedDiff = [];
          const contextSize = 3;
          let inHunk = false;
          let lastHunkEnd = -1;
          
          for (let k = 0; k < diffLines.length; k++) {
            const isChange = diffLines[k].type === 'add' || diffLines[k].type === 'del';
            if (isChange) {
              if (!inHunk) {
                const hunkStart = Math.max(lastHunkEnd + 1, k - contextSize);
                if (hunkStart > 0 && hunkStart > lastHunkEnd + 1) {
                  formattedDiff.push('...');
                }
                for (let c = hunkStart; c < k; c++) {
                  formattedDiff.push(`  ${diffLines[c].line}`);
                }
                inHunk = true;
              }
              
              if (diffLines[k].type === 'add') {
                formattedDiff.push(`+ ${diffLines[k].line}`);
              } else {
                formattedDiff.push(`- ${diffLines[k].line}`);
              }
            } else {
              if (inHunk) {
                let nextChangeWithinRange = false;
                for (let next = k + 1; next <= k + contextSize * 2; next++) {
                  if (next < diffLines.length && (diffLines[next].type === 'add' || diffLines[next].type === 'del')) {
                    nextChangeWithinRange = true;
                    break;
                  }
                }
                
                if (!nextChangeWithinRange) {
                  const hunkEnd = Math.min(diffLines.length - 1, k + contextSize);
                  for (let c = k; c <= hunkEnd; c++) {
                    formattedDiff.push(`  ${diffLines[c].line}`);
                  }
                  lastHunkEnd = hunkEnd;
                  inHunk = false;
                  k = hunkEnd;
                } else {
                  formattedDiff.push(`  ${diffLines[k].line}`);
                }
              }
            }
          }
          
          if (inHunk) {
            lastHunkEnd = diffLines.length - 1;
          } else if (lastHunkEnd < diffLines.length - 1 && lastHunkEnd !== -1) {
            formattedDiff.push('...');
          }
          
          return formattedDiff.join('\n');
        };

        const getLineNumber = (content, index) => {
          const sub = content.slice(0, index);
          return sub.split('\n').length;
        };

        // 1. Process single file operation if filePath and operations are specified
        if (filePath && operations && operations.length > 0) {
          const resolvedPath = resolveSafePath(filePath);
          let fileContent = await loadFile(filePath);

          for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            const unescape = op.unescape !== false;

            let targetStartIdx = 0;
            let targetEndIdx = fileContent.length;

            if (op.startLine || op.endLine) {
              const lines = fileContent.split('\n');
              let startIdx = op.startLine ? Math.max(0, op.startLine - 1) : 0;
              let endIdx = op.endLine ? Math.min(lines.length, op.endLine) : lines.length;

              let charAcc = 0;
              for (let l = 0; l < lines.length; l++) {
                if (l === startIdx) targetStartIdx = charAcc;
                charAcc += lines[l].length + 1;
                if (l === endIdx - 1) {
                  targetEndIdx = charAcc - 1;
                  break;
                }
              }
            }

            if (op.startAnchor) {
              const cleanAnchor = unescape ? unescapeString(op.startAnchor) : op.startAnchor;
              const idx = fileContent.indexOf(cleanAnchor, targetStartIdx);
              if (idx === -1 || idx > targetEndIdx) {
                return { success: false, error: `Operation [${i}]: Start anchor "${op.startAnchor}" not found in targeted range.` };
              }
              targetStartIdx = idx + cleanAnchor.length;
            }

            if (op.endAnchor) {
              const cleanAnchor = unescape ? unescapeString(op.endAnchor) : op.endAnchor;
              const idx = fileContent.indexOf(cleanAnchor, targetStartIdx);
              if (idx === -1 || idx > targetEndIdx) {
                return { success: false, error: `Operation [${i}]: End anchor "${op.endAnchor}" not found in targeted range.` };
              }
              targetEndIdx = idx;
            }

            const prefix = fileContent.slice(0, targetStartIdx);
            let targetSection = fileContent.slice(targetStartIdx, targetEndIdx);
            const suffix = fileContent.slice(targetEndIdx);

            if (op.action === 'write') {
              const contentVal = op.content !== undefined ? op.content : '';
              targetSection = unescape ? unescapeString(contentVal) : contentVal;
            } 
            else if (op.action === 'append') {
              const contentVal = op.content !== undefined ? op.content : '';
              targetSection = targetSection + (unescape ? unescapeString(contentVal) : contentVal);
            } 
            else if (op.action === 'replace') {
              const replaceVal = op.replace !== undefined ? op.replace : '';
              const finalReplace = unescape ? unescapeString(replaceVal) : replaceVal;

              if (op.search === undefined) {
                targetSection = finalReplace;
              } else if (op.isRegex) {
                const searchPat = unescape ? unescapeString(op.search) : op.search;
                const flags = op.regexFlags !== undefined ? op.regexFlags : 'g';
                const re = new RegExp(searchPat, flags);
                targetSection = targetSection.replace(re, finalReplace);
              } else {
                const finalSearch = unescape ? unescapeString(op.search) : op.search;
                if (targetSection.indexOf(finalSearch) === -1) {
                  return { success: false, error: `Operation [${i}]: Search pattern "${op.search}" not found inside target section.` };
                }
                targetSection = targetSection.split(finalSearch).join(finalReplace);
              }
            } 
            else if (op.action === 'insert_before') {
              const finalContent = op.content !== undefined ? (unescape ? unescapeString(op.content) : op.content) : '';

              if (op.search === undefined) {
                targetSection = finalContent + targetSection;
              } else {
                const finalSearch = unescape ? unescapeString(op.search) : op.search;
                const idx = targetSection.indexOf(finalSearch);
                if (idx === -1) {
                  return { success: false, error: `Operation [${i}]: Search pattern "${op.search}" not found inside target section.` };
                }
                targetSection = targetSection.slice(0, idx) + finalContent + targetSection.slice(idx);
              }
            } 
            else if (op.action === 'insert_after') {
              const finalContent = op.content !== undefined ? (unescape ? unescapeString(op.content) : op.content) : '';

              if (op.search === undefined) {
                targetSection = targetSection + finalContent;
              } else {
                const finalSearch = unescape ? unescapeString(op.search) : op.search;
                const idx = targetSection.indexOf(finalSearch);
                if (idx === -1) {
                  return { success: false, error: `Operation [${i}]: Search pattern "${op.search}" not found inside target section.` };
                }
                const insertIdx = idx + finalSearch.length;
                targetSection = targetSection.slice(0, insertIdx) + finalContent + targetSection.slice(insertIdx);
              }
            }

            fileContent = prefix + targetSection + suffix;
          }

          fileContents[filePath] = fileContent;
          if (fileContent !== originalContents[filePath]) {
            modifiedFiles.add(filePath);
          }
        }

        // 2. Process correlation if requested
        let correlationReport = null;
        if (correlate) {
          let scanFiles = correlate.files || files || [];
          if (scanFiles.length === 0) {
            scanFiles = await getWorkspaceFiles();
          }

          for (const f of scanFiles) {
            await loadFile(f);
          }

          const definitions = [];
          const reservedKeywords = new Set([
            'if', 'while', 'for', 'switch', 'catch', 'return', 'else', 'using', 'namespace', 
            'template', 'typedef', 'operator', 'const', 'let', 'var', 'class', 'struct', 'func', 'def', 'function',
            'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'override', 'virtual',
            'internal', 'async', 'await', 'fn', 'fun', 'object', 'module', 'protocol', 'interface', 'enum',
            'new', 'super', 'this', 'import', 'export', 'package', 'throws', 'throw', 'do', 'case', 'break', 'continue'
          ]);

          for (const f of scanFiles) {
            const fileContent = fileContents[f];
            const ext = path.extname(f).toLowerCase();

            const classRegexes = [];
            const funcRegexes = [];

            if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
            } else if (['.py'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            } else if (['.go'].includes(ext)) {
              classRegexes.push(/\btype\s+([a-zA-Z0-9_$]+)\s+struct\b/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_$]+)\s*\(/g);
              funcRegexes.push(/\bfunc\s*\([^)]+\)\s*([a-zA-Z0-9_$]+)\s*\(/g);
            } else if (['.cpp', '.hpp', '.h', '.cc', '.cxx', '.c'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:const)?\s*\{/g);
            } else if (['.java'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[a-zA-Z0-9_$,\s]+)?\s*\{/g);
            } else if (['.cs'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|struct|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.dart'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.lua'].includes(ext)) {
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_.:]+)\s*\(/g);
            } else if (['.pl', '.pm'].includes(ext)) {
              classRegexes.push(/\bpackage\s+([a-zA-Z0-9_:]+)/g);
              funcRegexes.push(/\bsub\s+([a-zA-Z0-9_]+)/g);
            } else if (['.r', '.R'].includes(ext)) {
              classRegexes.push(/\bsetClass\s*\(\s*["']([a-zA-Z0-9_]+)["']/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*(?:<-|=)\s*function\b/g);
            } else if (['.hs'].includes(ext)) {
              classRegexes.push(/\b(?:data|newtype|class)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*::\s*/g);
            } else if (['.ex', '.exs'].includes(ext)) {
              classRegexes.push(/\bdefmodule\s+([a-zA-Z0-9_.]+)/g);
              funcRegexes.push(/\bdefp?\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.clj', '.cljs'].includes(ext)) {
              classRegexes.push(/\(\s*ns\s+([a-zA-Z0-9_.-]+)/g);
              funcRegexes.push(/\(\s*defn-?\s+([a-zA-Z0-9_.-?!]+)/g);
            } else if (['.jl'].includes(ext)) {
              classRegexes.push(/\b(?:mutable\s+)?struct\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b(?:function|macro)\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.sql'].includes(ext)) {
              classRegexes.push(/\bCREATE\s+(?:TABLE|VIEW)\s+([a-zA-Z0-9_]+)/gi);
              funcRegexes.push(/\bCREATE\s+(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_]+)/gi);
            } else if (['.rs'].includes(ext)) {
              classRegexes.push(/\b(?:struct|enum|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.rb'].includes(ext)) {
              classRegexes.push(/\b(?:class|module)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_?!]+)/g);
            } else if (['.php'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_]+)\s*\(/g);
            } else if (['.swift'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct|enum|protocol)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.kt', '.kts'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|object)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfun\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.scala'].includes(ext)) {
              classRegexes.push(/\b(?:class|trait|object)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.css'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@keyframes\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.scss'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              classRegexes.push(/%([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@(?:mixin|function)\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.sass'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)/g);
              funcRegexes.push(/(?:@mixin\s+|=)([a-zA-Z0-9_-]+)/g);
            } else if (['.less'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/\.([a-zA-Z0-9_-]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.sh', '.bash'].includes(ext)) {
              funcRegexes.push(/\b([a-zA-Z0-9_-]+)\s*\(\s*\)\s*\{/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_-]+)/g);
            } else {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            }

            const processRegex = (re, type) => {
              let match;
              re.lastIndex = 0;
              while ((match = re.exec(fileContent)) !== null) {
                const name = match[1];
                if (reservedKeywords.has(name)) continue;
                const line = getLineNumber(fileContent, match.index);
                definitions.push({
                  name,
                  type,
                  file: f,
                  line
                });
              }
            };

            for (const re of classRegexes) processRegex(re, 'class');
            for (const re of funcRegexes) processRegex(re, 'function');
          }

          const targetNames = new Set();
          if (correlate.targets && correlate.targets.length > 0) {
            for (const t of correlate.targets) {
              targetNames.add(t);
            }
          } else {
            for (const d of definitions) {
              targetNames.add(d.name);
            }
          }

          const references = {};
          for (const name of targetNames) {
            references[name] = [];
          }

          for (const f of scanFiles) {
            const fileContent = fileContents[f];
            const lines = fileContent.split('\n');

            for (const name of targetNames) {
              const re = new RegExp('(^|[^a-zA-Z0-9_$])' + escapeRegExp(name) + '(?![a-zA-Z0-9_$])', 'g');

              for (let l = 0; l < lines.length; l++) {
                const lineContent = lines[l];
                re.lastIndex = 0;
                if (re.test(lineContent)) {
                  const isDef = definitions.some(d => d.name === name && d.file === f && d.line === l + 1);
                  if (isDef) continue;

                  references[name].push({
                    file: f,
                    line: l + 1,
                    lineContent: lineContent.trim()
                  });
                }
              }
            }
          }

          correlationReport = {
            definitions: correlate.targets ? definitions.filter(d => targetNames.has(d.name)) : definitions,
            references
          };
        }

        // 3. Process propagateCorrelations if requested
        if (propagateCorrelations && propagateCorrelations.length > 0) {
          for (const prop of propagateCorrelations) {
            let propFiles = prop.files || files || [];
            if (propFiles.length === 0) {
              propFiles = await getWorkspaceFiles();
            }

            for (const f of propFiles) {
              await loadFile(f);
            }

            for (const f of propFiles) {
              const fileContent = fileContents[f];
              const re = new RegExp('(^|[^a-zA-Z0-9_$])' + escapeRegExp(prop.search) + '(?![a-zA-Z0-9_$])', 'g');
              const newContent = fileContent.replace(re, `$1${prop.replace}`);

              if (newContent !== fileContent) {
                fileContents[f] = newContent;
                modifiedFiles.add(f);
              }
            }
          }
        }

        // 4. Process searchFunctionality if requested
        let functionalityReport = null;
        if (searchFunctionality) {
          const query = searchFunctionality.query;
          const includeComments = searchFunctionality.includeComments !== false;
          const includeDefinitionsOnly = !!searchFunctionality.includeDefinitionsOnly;

          let searchFiles = searchFunctionality.files || files || [];
          if (searchFiles.length === 0) {
            searchFiles = await getWorkspaceFiles();
          }

          for (const f of searchFiles) {
            await loadFile(f);
          }

          let queryRegex;
          try {
            queryRegex = new RegExp(query, 'i');
          } catch (err) {
            queryRegex = new RegExp(escapeRegExp(query), 'i');
          }

          const matches = [];

          const getFileDefinitions = (f, fileContent) => {
            const ext = path.extname(f).toLowerCase();
            const classRegexes = [];
            const funcRegexes = [];
            const fileDefs = [];

            const reservedKeywords = new Set([
              'if', 'while', 'for', 'switch', 'catch', 'return', 'else', 'using', 'namespace', 
              'template', 'typedef', 'operator', 'const', 'let', 'var', 'class', 'struct', 'func', 'def', 'function',
              'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'override', 'virtual',
              'internal', 'async', 'await', 'fn', 'fun', 'object', 'module', 'protocol', 'interface', 'enum',
              'new', 'super', 'this', 'import', 'export', 'package', 'throws', 'throw', 'do', 'case', 'break', 'continue'
            ]);

            if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
            } else if (['.py'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            } else if (['.go'].includes(ext)) {
              classRegexes.push(/\btype\s+([a-zA-Z0-9_$]+)\s+struct\b/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_$]+)\s*\(/g);
              funcRegexes.push(/\bfunc\s*\([^)]+\)\s*([a-zA-Z0-9_$]+)\s*\(/g);
            } else if (['.cpp', '.hpp', '.h', '.cc', '.cxx', '.c'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:const)?\s*\{/g);
            } else if (['.java'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[a-zA-Z0-9_$,\s]+)?\s*\{/g);
            } else if (['.cs'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|struct|enum)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.dart'].includes(ext)) {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\b[a-zA-Z0-9_:<>\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.lua'].includes(ext)) {
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_.:]+)\s*\(/g);
            } else if (['.pl', '.pm'].includes(ext)) {
              classRegexes.push(/\bpackage\s+([a-zA-Z0-9_:]+)/g);
              funcRegexes.push(/\bsub\s+([a-zA-Z0-9_]+)/g);
            } else if (['.r', '.R'].includes(ext)) {
              classRegexes.push(/\bsetClass\s*\(\s*["']([a-zA-Z0-9_]+)["']/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*(?:<-|=)\s*function\b/g);
            } else if (['.hs'].includes(ext)) {
              classRegexes.push(/\b(?:data|newtype|class)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b([a-zA-Z0-9_]+)\s*::\s*/g);
            } else if (['.ex', '.exs'].includes(ext)) {
              classRegexes.push(/\bdefmodule\s+([a-zA-Z0-9_.]+)/g);
              funcRegexes.push(/\bdefp?\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.clj', '.cljs'].includes(ext)) {
              classRegexes.push(/\(\s*ns\s+([a-zA-Z0-9_.-]+)/g);
              funcRegexes.push(/\(\s*defn-?\s+([a-zA-Z0-9_.-?!]+)/g);
            } else if (['.jl'].includes(ext)) {
              classRegexes.push(/\b(?:mutable\s+)?struct\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\b(?:function|macro)\s+([a-zA-Z0-9_!?]+)/g);
            } else if (['.sql'].includes(ext)) {
              classRegexes.push(/\bCREATE\s+(?:TABLE|VIEW)\s+([a-zA-Z0-9_]+)/gi);
              funcRegexes.push(/\bCREATE\s+(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_]+)/gi);
            } else if (['.rs'].includes(ext)) {
              classRegexes.push(/\b(?:struct|enum|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.rb'].includes(ext)) {
              classRegexes.push(/\b(?:class|module)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_?!]+)/g);
            } else if (['.php'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|trait)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_]+)\s*\(/g);
            } else if (['.swift'].includes(ext)) {
              classRegexes.push(/\b(?:class|struct|enum|protocol)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfunc\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.kt', '.kts'].includes(ext)) {
              classRegexes.push(/\b(?:class|interface|object)\s+([a-zA-Z0-9_]+)/g);
              funcRegexes.push(/\bfun\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.scala'].includes(ext)) {
              classRegexes.push(/\b(?:class|trait|object)\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)\s*(?:<[^>]+>)?\s*\(/g);
            } else if (['.css'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@keyframes\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.scss'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              classRegexes.push(/%([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/@(?:mixin|function)\s+([a-zA-Z0-9_-]+)/g);
            } else if (['.sass'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)/g);
              funcRegexes.push(/(?:@mixin\s+|=)([a-zA-Z0-9_-]+)/g);
            } else if (['.less'].includes(ext)) {
              classRegexes.push(/\.([a-zA-Z0-9_-]+)\s*(?:,|{)/g);
              funcRegexes.push(/\.([a-zA-Z0-9_-]+)\s*\([^)]*\)\s*\{/g);
            } else if (['.sh', '.bash'].includes(ext)) {
              funcRegexes.push(/\b([a-zA-Z0-9_-]+)\s*\(\s*\)\s*\{/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_-]+)/g);
            } else {
              classRegexes.push(/\bclass\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bfunction\s+([a-zA-Z0-9_$]+)/g);
              funcRegexes.push(/\bdef\s+([a-zA-Z0-9_$]+)/g);
            }

            const processRegex = (re, type) => {
              let match;
              re.lastIndex = 0;
              while ((match = re.exec(fileContent)) !== null) {
                const name = match[1];
                if (reservedKeywords.has(name)) continue;
                const line = getLineNumber(fileContent, match.index);
                fileDefs.push({
                  name,
                  type,
                  file: f,
                  line
                });
              }
            };

            for (const re of classRegexes) processRegex(re, 'class');
            for (const re of funcRegexes) processRegex(re, 'function');

            fileDefs.sort((a, b) => a.line - b.line);
            return fileDefs;
          };

          for (const f of searchFiles) {
            const fileContent = fileContents[f];
            const ext = path.extname(f).toLowerCase();
            const lines = fileContent.split('\n');

            const fileDefs = getFileDefinitions(f, fileContent);

            let insideBlock = false;
            let blockType = '';

            for (let l = 0; l < lines.length; l++) {
              const lineContent = lines[l];
              const trimmed = lineContent.trim();
              const lineNo = l + 1;

              let isComment = false;
              if (insideBlock) {
                isComment = true;
                if (blockType === '/*' && trimmed.includes('*/')) {
                  insideBlock = false;
                } else if (blockType === '"""' && trimmed.includes('"""')) {
                  insideBlock = false;
                } else if (blockType === "'''" && trimmed.includes("'''")) {
                  insideBlock = false;
                } else if (blockType === '<!--' && trimmed.includes('-->')) {
                  insideBlock = false;
                } else if (blockType === '=begin' && trimmed.startsWith('=end')) {
                  insideBlock = false;
                }
              } else {
                if (
                  trimmed.startsWith('//') ||
                  trimmed.startsWith('#') ||
                  trimmed.startsWith('--') ||
                  (trimmed.startsWith('*') && ext !== '.css' && ext !== '.scss' && ext !== '.sass' && ext !== '.less')
                ) {
                  isComment = true;
                } else if (trimmed.startsWith('/*')) {
                  isComment = true;
                  if (!trimmed.includes('*/')) {
                    insideBlock = true;
                    blockType = '/*';
                  }
                } else if (trimmed.startsWith('<!--')) {
                  isComment = true;
                  if (!trimmed.includes('-->')) {
                    insideBlock = true;
                    blockType = '<!--';
                  }
                } else if (trimmed.startsWith('"""') && ['.py'].includes(ext)) {
                  isComment = true;
                  if (!trimmed.slice(3).includes('"""')) {
                    insideBlock = true;
                    blockType = '"""';
                  }
                } else if (trimmed.startsWith("'''") && ['.py'].includes(ext)) {
                  isComment = true;
                  if (!trimmed.slice(3).includes("'''")) {
                    insideBlock = true;
                    blockType = "'''";
                  }
                } else if (trimmed.startsWith('=begin') && ['.rb'].includes(ext)) {
                  isComment = true;
                  insideBlock = true;
                  blockType = '=begin';
                }
              }

              if (!includeComments && isComment) {
                continue;
              }

              if (includeDefinitionsOnly) {
                const definitionAtLine = fileDefs.find(d => d.line === lineNo);
                if (definitionAtLine) {
                  if (queryRegex.test(definitionAtLine.name) || queryRegex.test(lineContent)) {
                    matches.push({
                      file: f,
                      line: lineNo,
                      lineContent: lineContent,
                      isDefinition: true,
                      definitionType: definitionAtLine.type,
                      definitionName: definitionAtLine.name,
                      enclosingFunctionality: null
                    });
                  }
                }
                continue;
              }

              if (queryRegex.test(lineContent)) {
                let enclosingFunctionality = null;
                for (let i = fileDefs.length - 1; i >= 0; i--) {
                  if (fileDefs[i].line <= lineNo) {
                    enclosingFunctionality = {
                      name: fileDefs[i].name,
                      type: fileDefs[i].type,
                      line: fileDefs[i].line
                    };
                    break;
                  }
                }

                const definitionAtLine = fileDefs.find(d => d.line === lineNo);

                matches.push({
                  file: f,
                  line: lineNo,
                  lineContent: lineContent,
                  isComment,
                  isDefinition: !!definitionAtLine,
                  definitionType: definitionAtLine ? definitionAtLine.type : null,
                  definitionName: definitionAtLine ? definitionAtLine.name : null,
                  enclosingFunctionality
                });
              }
            }
          }

          functionalityReport = {
            query,
            matches
          };
        }

        if (!(filePath && operations) && !correlate && !propagateCorrelations && !searchFunctionality) {
          return { success: false, error: 'At least one of (filePath & operations), correlate, propagateCorrelations, or searchFunctionality must be specified.' };
        }

        const modifiedDiffs = {};
        for (const f of modifiedFiles) {
          const resolved = resolveSafePath(f);
          const original = originalContents[f];
          let modified = fileContents[f];

          if (!dryRun) {
            const dir = path.dirname(resolved);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(resolved, modified, 'utf-8');

            if (lintAndFormat) {
              const formatCmd = `npx prettier --write "${resolved}"`;
              await new Promise((resolve) => {
                exec(formatCmd, () => {
                  resolve();
                });
              });
              modified = await fs.readFile(resolved, 'utf-8');
              fileContents[f] = modified;
            }
          }

          const diff = generateUnifiedDiff(original, modified);
          modifiedDiffs[f] = diff;
        }

        if (filePath && operations && !correlate && !propagateCorrelations && !searchFunctionality) {
          const diff = modifiedDiffs[filePath] || '';
          return {
            success: true,
            message: dryRun ? `Dry-run simulation complete for ${filePath}.` : (lintAndFormat ? `Successfully modified, linted, and formatted ${filePath}.` : `Successfully modified ${filePath}.`),
            diff
          };
        }

        const response = {
          success: true,
          message: dryRun ? `Dry-run simulation complete.` : `Successfully processed changes.`,
          modifiedFiles: Array.from(modifiedFiles),
          diffs: modifiedDiffs
        };

        if (correlationReport) {
          response.correlations = correlationReport;
        }

        if (functionalityReport) {
          response.functionalities = functionalityReport;
        }

        return response;
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),
};
