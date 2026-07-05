const sessionTokens = { input: 0, output: 0 };

export function getSessionTokens() {
  return {
    input: sessionTokens.input,
    output: sessionTokens.output,
    total: sessionTokens.input + sessionTokens.output
  };
}

export function resetSessionTokens() {
  sessionTokens.input = 0;
  sessionTokens.output = 0;
}

export function addSessionTokens(input, output) {
  if (typeof input === 'number') {
    sessionTokens.input += input;
  }
  if (typeof output === 'number') {
    sessionTokens.output += output;
  }
}
