/**
 * Centralized Terminal I/O Sanitization Utilities
 * Strips terminal capability/cursor position responses (OSC 10/11, CSI 6n/c)
 * without corrupting legitimate alphanumeric tokens like "32R" or "100R".
 */

/**
 * Strips leaked terminal query/response escape sequences from a string.
 * @param {string} str
 * @returns {string}
 */
export function stripTerminalQueryGarbage(str) {
  if (typeof str !== 'string' || !str) return str;
  return str
    // Strip OSC 10 / 11 color query responses (e.g. ]10;rgb:ffff/ffff/ffff\x07 or \x1b\)
    .replace(/(?:\x1b\]|\])1[01];rgb:[0-9a-fA-F/]+(?:\x07|\x1b\\|\\)?/g, '')
    .replace(/rgb:[0-9a-fA-F]{2,4}\/[0-9a-fA-F]{2,4}\/[0-9a-fA-F]{2,4}/g, '')
    // Strip CSI cursor position reports (\x1b[row;colR or [row;colR or ?1;2c)
    .replace(/(?:\x1b\[|\[\??)\d+(?:;\d+)+[Rcn]/g, '')
    // Strip fragmented cursor report suffixes like ";1R" or "40;1R" (requiring semicolon so "32R" is preserved)
    .replace(/(?:\b\d+)?;\d+R\b/g, '');
}

let sanitizerInstalled = false;

/**
 * Installs a single unified stdout/stderr write filter that suppresses
 * raw terminal capability query leaks while optionally filtering ADK info logs.
 * @param {() => boolean} isAdkInfoEnabled
 */
export function installTerminalOutputSanitizer(isAdkInfoEnabled = () => false) {
  if (sanitizerInstalled) return;
  sanitizerInstalled = true;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk, encoding, callback) => {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
      const str = chunk.toString();
      if (!isAdkInfoEnabled() && (str.includes('[ADK ') || str.includes('google_adk'))) {
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
        return true;
      }
      if (/(?:\x1b\]|\])1[01];rgb:|(?:\x1b\[|\[\??)\d+(?:;\d+)+[Rcn]/.test(str)) {
        const cleaned = stripTerminalQueryGarbage(str);
        if (!cleaned) {
          if (typeof encoding === 'function') encoding();
          else if (typeof callback === 'function') callback();
          return true;
        }
        return origStdoutWrite(cleaned, encoding, callback);
      }
    }
    return origStdoutWrite(chunk, encoding, callback);
  };

  process.stderr.write = (chunk, encoding, callback) => {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
      const str = chunk.toString();
      if (!isAdkInfoEnabled() && (str.includes('[ADK ') || str.includes('google_adk'))) {
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
        return true;
      }
      if (/(?:\x1b\]|\])1[01];rgb:|(?:\x1b\[|\[\??)\d+(?:;\d+)+[Rcn]/.test(str)) {
        const cleaned = stripTerminalQueryGarbage(str);
        if (!cleaned) {
          if (typeof encoding === 'function') encoding();
          else if (typeof callback === 'function') callback();
          return true;
        }
        return origStderrWrite(cleaned, encoding, callback);
      }
    }
    return origStderrWrite(chunk, encoding, callback);
  };
}
