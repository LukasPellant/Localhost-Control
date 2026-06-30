const SECRET_VALUE_PATTERN = /(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|DATABASE_URL|PASSWORD|SECRET|TOKEN|API_KEY)=("[^"]*"|'[^']*'|\S+)/gi;
const SECRET_FLAG_PATTERN = /(--(?:token|api-key|password|secret)\s+)("[^"]*"|'[^']*'|\S+)/gi;
const SECRET_FLAG_EQUALS_PATTERN = /(--(?:token|api-key|password|secret)=)("[^"]*"|'[^']*'|\S+)/gi;
const AUTH_HEADER_PATTERN = /(Authorization:\s*Bearer\s+)\S+/gi;
const SECRET_QUERY_KEYS = /(?:^|[_-])(?:access[_-]?token|api[_-]?key|apikey|auth|code|key|password|secret|token)$/i;

export const stripControlCharacters = (value: string): string =>
  value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();

const redactUserPaths = (value: string): string =>
  value
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, (match) => `${match.slice(0, 9)}[user]`)
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/\/home\/[^/\s]+/g, "/home/[user]");

export const redactSensitiveText = (value: string): string =>
  redactUserPaths(stripControlCharacters(value))
    .replace(SECRET_VALUE_PATTERN, "$1=[redacted]")
    .replace(SECRET_FLAG_PATTERN, "$1[redacted]")
    .replace(SECRET_FLAG_EQUALS_PATTERN, "$1[redacted]")
    .replace(AUTH_HEADER_PATTERN, "$1[redacted]");

export const sanitizeLocalUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.forEach((_paramValue, key) => {
      if (SECRET_QUERY_KEYS.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    });
    return redactUserPaths(stripControlCharacters(url.toString().replace(/%5Bredacted%5D/gi, "[redacted]").replace(/\/$/, "")));
  } catch {
    return redactSensitiveText(value);
  }
};
