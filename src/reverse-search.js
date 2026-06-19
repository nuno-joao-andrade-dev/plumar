import readline from 'readline';
import pc from 'picocolors';

/**
 * Loads searchable history from both active readline command history and previous persistent logs
 */
export async function loadSearchHistory(rl, sessionService) {
  const historySet = new Set();

  // 1. Current session command / prompt history
  if (rl && rl.history) {
    rl.history.forEach(item => {
      if (item && item.trim()) {
        historySet.add(item.trim());
      }
    });
  }

  // 2. Deep persistent session logs (fetched from disk)
  if (sessionService) {
    try {
      const { sessions } = await sessionService.listSessions({
        appName: 'plumar-cli',
        userId: 'default-user',
        order: 'desc'
      });

      for (const sessionSummary of sessions) {
        const fullSession = await sessionService.getSession({
          appName: 'plumar-cli',
          userId: 'default-user',
          sessionId: sessionSummary.id
        });

        if (fullSession && fullSession.events) {
          for (const event of fullSession.events) {
            let text = '';
            if (event.content && Array.isArray(event.content.parts)) {
              for (const part of event.content.parts) {
                if (part.text) {
                  text += part.text;
                }
              }
            } else if (Array.isArray(event.parts)) {
              for (const part of event.parts) {
                if (part.text) {
                  text += part.text;
                }
              }
            } else if (event.content && typeof event.content === 'string') {
              text = event.content;
            } else if (event.text && typeof event.text === 'string') {
              text = event.text;
            }

            const trimmed = text.trim();
            // Index only shorter, readable items (under 250 chars) to prevent prompt overflows
            if (trimmed && trimmed.length < 250 && !trimmed.startsWith('/') && !trimmed.includes('\n')) {
              historySet.add(trimmed);
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  return Array.from(historySet);
}

/**
 * Interactive reverse-i-search prompt loop
 */
export async function startReverseSearch(rl, sessionService) {
  const historyList = await loadSearchHistory(rl, sessionService);

  return new Promise((resolve) => {
    let query = '';
    let matchIndex = 0;
    let selectedResult = '';

    const render = () => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      const matches = historyList.filter(item => 
        item.toLowerCase().includes(query.toLowerCase())
      );

      let displayText = '';
      if (matches.length > 0) {
        const idx = matchIndex % matches.length;
        selectedResult = matches[idx];
        displayText = selectedResult;
      } else {
        selectedResult = '';
        displayText = pc.red('(no match)');
      }

      process.stdout.write(
        pc.cyan(`(reverse-i-search)\`${pc.bold(query)}': `) + pc.yellow(displayText)
      );
    };

    const handleKeypress = (char, key) => {
      if (key) {
        // Abort search
        if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
          cleanup(null);
          return;
        }

        // Accept match
        if (key.name === 'return' || key.name === 'enter') {
          cleanup(selectedResult);
          return;
        }

        // Backspace
        if (key.name === 'backspace') {
          query = query.slice(0, -1);
          matchIndex = 0;
          render();
          return;
        }

        // Cycle through matches
        if (key.ctrl && key.name === 'r') {
          matchIndex++;
          render();
          return;
        }
      }

      // Normal typing
      if (char && !key.ctrl && !key.meta && key.name !== 'escape' && key.name !== 'enter' && key.name !== 'return') {
        query += char;
        matchIndex = 0;
        render();
      }
    };

    const cleanup = (finalResult) => {
      process.stdin.removeListener('keypress', handleKeypress);
      
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      // Re-render the original prompt prefix
      process.stdout.write(pc.green(pc.bold('You › ')));

      resolve(finalResult);
    };

    process.stdin.on('keypress', handleKeypress);
    render();
  });
}

/**
 * Registers global process.stdin listener to hook Ctrl+R shortcut elegantly
 */
export function registerReverseSearchHook(rl, sessionService) {
  const originalEmit = process.stdin.emit;
  process.stdin._originalEmit = originalEmit;

  let isSearching = false;

  process.stdin.emit = function(event, ...args) {
    if (event === 'keypress') {
      const key = args[1];
      if (key && key.ctrl && key.name === 'r' && !isSearching) {
        isSearching = true;

        // Temporarily pause active readline interface
        rl.pause();

        // Restore original emit so keypresses can be parsed during search
        process.stdin.emit = originalEmit;

        startReverseSearch(rl, sessionService).then((result) => {
          // Re-wrap process.stdin.emit for future Ctrl+R intercepts
          process.stdin.emit = process.stdin._wrappedEmit;
          isSearching = false;

          rl.resume();

          if (result) {
            // Write the found item into readline's active buffer
            rl.write(result);
          }
        });

        return true;
      }
    }
    return originalEmit.apply(this, [event, ...args]);
  };

  process.stdin._wrappedEmit = process.stdin.emit;
}
