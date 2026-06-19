import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    const { jsonrpc, id, method, params } = request;
    
    if (jsonrpc !== '2.0') return;
    
    if (method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: {
            name: 'google-search-mcp',
            version: '1.0.0'
          }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
    
    else if (method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'search',
              description: 'Performs a Google/DuckDuckGo web search to retrieve relevant page titles, URLs, and snippets of matching results.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The search query to look up'
                  }
                },
                required: ['query']
              }
            }
          ]
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
    
    else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      if (name === 'search') {
        const query = args?.query || '';
        try {
          const results = await performSearch(query);
          const response = {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(results, null, 2)
                }
              ]
            }
          };
          process.stdout.write(JSON.stringify(response) + '\n');
        } catch (err) {
          const response = {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: err.message
            }
          };
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } else {
        const response = {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Tool not found: ${name}`
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    }
  } catch (err) {
    process.stderr.write(`Error parsing line: ${err.message}\n`);
  }
});

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function performSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(5000)
  });
  
  if (!res.ok) {
    throw new Error(`Failed to fetch search results: HTTP ${res.status}`);
  }
  
  const html = await res.text();
  const results = [];
  const titleRegex = /<h2 class="result__title">([\s\S]*?)<\/h2>/g;
  let match;
  
  while ((match = titleRegex.exec(html)) !== null) {
    const titleBlock = match[1];
    const aMatch = titleBlock.match(/class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!aMatch) continue;
    
    let rawUrl = aMatch[1];
    let title = decodeHtmlEntities(aMatch[2].replace(/<[^>]+>/g, '').trim());
    
    let url = rawUrl;
    const urlMatch = rawUrl.match(/uddg=([^&]+)/);
    if (urlMatch) {
      url = decodeURIComponent(urlMatch[1]);
    } else if (rawUrl.startsWith('//')) {
      url = 'https:' + rawUrl;
    }
    
    const nextSlice = html.slice(match.index + match[0].length, match.index + match[0].length + 4000);
    const snippetMatch = nextSlice.match(/<a\s+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    let snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, '').trim()) : '';
    if (snippet.length > 250) {
      snippet = snippet.slice(0, 247) + '...';
    }
    
    results.push({ title, url, snippet });
  }
  
  return results.slice(0, 3);
}
