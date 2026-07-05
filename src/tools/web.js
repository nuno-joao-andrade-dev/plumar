import { FunctionTool } from '@google/adk';
import { z } from 'zod';

export const webTools = {
  fetchWebPage: new FunctionTool({
    name: 'fetchWebPage',
    description: 'Fetch the text content of a public URL or API endpoint. Useful for fetching live JSON or reference web documentation.',
    parameters: z.object({
      url: z.string().url().describe('The HTTP/HTTPS URL to fetch, e.g. "https://jsonplaceholder.typicode.com/todos/1"'),
    }),
    execute: async ({ url }) => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 8000); // 8-second timeout
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        
        const contentType = response.headers.get('content-type') || '';
        let content = '';
        
        if (contentType.includes('application/json')) {
          const json = await response.json();
          content = JSON.stringify(json, null, 2);
        } else {
          content = await response.text();
          // Strip HTML tags for clean display if it is HTML
          if (contentType.includes('text/html')) {
            content = content
              .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
              .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          }
        }
        
        const isTruncated = content.length > 5000;
        const resultText = isTruncated ? content.slice(0, 5000) + '\n[... TRUNCATED ...]' : content;
        
        return {
          success: true,
          url,
          status: response.status,
          contentType,
          isTruncated,
          content: resultText,
        };
      } catch (error) {
        return { success: false, error: error.name === 'AbortError' ? 'Request timed out after 8 seconds.' : error.message };
      }
    },
  }),

  restClient: new FunctionTool({
    name: 'restClient',
    description: 'Send custom HTTP requests (GET, POST, PUT, DELETE, PATCH) to an endpoint to test REST APIs with custom headers and bodies.',
    parameters: z.object({
      url: z.string().url().describe('The destination URL of the REST API (e.g. "https://api.github.com/users/octocat").'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET').describe('The HTTP method to use.'),
      headers: z.record(z.string()).optional().describe('Key-value pairs for HTTP headers.'),
      body: z.string().optional().describe('The body string to send (e.g. raw JSON).')
    }),
    execute: async ({ url, method = 'GET', headers = {}, body }) => {
      try {
        const startTime = Date.now();
        const fetchOptions = {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        };
        if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);
        const durationMs = Date.now() - startTime;
        const responseHeaders = {};
        response.headers.forEach((v, k) => {
          responseHeaders[k] = v;
        });

        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          success: true,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          headers: responseHeaders,
          data
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }),

  apiPerformanceTest: new FunctionTool({
    name: 'apiPerformanceTest',
    description: 'Execute a lightweight performance and load test on a specified API endpoint. Measures latency, throughput, success rates, and response times.',
    parameters: z.object({
      url: z.string().url().describe('The URL endpoint to performance test'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET').describe('The HTTP method to use'),
      headers: z.record(z.string()).optional().describe('Optional custom HTTP headers'),
      body: z.string().optional().describe('Optional HTTP request body'),
      requests: z.number().int().min(1).max(500).optional().default(50).describe('Total number of requests to perform (max 500)'),
      concurrency: z.number().int().min(1).max(50).optional().default(5).describe('Number of concurrent workers (max 50)'),
    }),
    execute: async ({ url, method = 'GET', headers = {}, body, requests = 50, concurrency = 5 }) => {
      try {
        const requestTimes = [];
        let successCount = 0;
        let failCount = 0;
        const statusDistribution = {};
        
        const startTime = Date.now();
        let index = 0;

        const worker = async () => {
          while (true) {
            if (index >= requests) return;
            const currentRequestIndex = index++;
            
            const reqStart = Date.now();
            try {
              const options = {
                method,
                headers: {
                  'Content-Type': 'application/json',
                  ...headers
                },
              };
              if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
                options.body = body;
              }
              
              const response = await fetch(url, options);
              const reqEnd = Date.now();
              const duration = reqEnd - reqStart;
              requestTimes.push(duration);
              
              const status = response.status;
              statusDistribution[status] = (statusDistribution[status] || 0) + 1;
              
              if (response.ok) {
                successCount++;
              } else {
                failCount++;
              }
            } catch (error) {
              const reqEnd = Date.now();
              const duration = reqEnd - reqStart;
              requestTimes.push(duration);
              failCount++;
              statusDistribution['Error'] = (statusDistribution['Error'] || 0) + 1;
            }
          }
        };

        const workers = Array.from({ length: Math.min(concurrency, requests) }, () => worker());
        await Promise.all(workers);
        
        const totalTime = Date.now() - startTime;
        const totalRequests = requestTimes.length;
        const minTime = totalRequests > 0 ? Math.min(...requestTimes) : 0;
        const maxTime = totalRequests > 0 ? Math.max(...requestTimes) : 0;
        const avgTime = totalRequests > 0 ? Number((requestTimes.reduce((a, b) => a + b, 0) / totalRequests).toFixed(2)) : 0;
        const rps = Number((totalRequests / (totalTime / 1000)).toFixed(2));
        
        const sortedTimes = [...requestTimes].sort((a, b) => a - b);
        const p95 = totalRequests > 0 ? sortedTimes[Math.floor(totalRequests * 0.95)] || sortedTimes[totalRequests - 1] : 0;
        const p99 = totalRequests > 0 ? sortedTimes[Math.floor(totalRequests * 0.99)] || sortedTimes[totalRequests - 1] : 0;

        return {
          success: true,
          summary: {
            url,
            method,
            totalRequests,
            concurrency,
            totalTimeMs: totalTime,
            requestsPerSecond: rps,
            successCount,
            failCount,
            errorRatePercent: Number(((failCount / totalRequests) * 100).toFixed(2)),
          },
          latencyMs: {
            min: minTime,
            max: maxTime,
            average: avgTime,
            p95,
            p99
          },
          statusDistribution
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),
};
