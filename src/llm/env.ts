/** Reads API keys from the environment, a `.env` up the tree, or an `export` line in ~/.zshrc. Never prints them. */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function fromDotenv(name: string): string | undefined {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`) || l.startsWith(`export ${name}=`));
      if (line) return unquote(line.slice(line.indexOf('=') + 1));
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function fromZshrc(name: string): string | undefined {
  const file = join(homedir(), '.zshrc');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`export ${name}=`));
  return line ? unquote(line.slice(line.indexOf('=') + 1)) : undefined;
}

export function requireKey(name: string, aliases: string[] = []): string {
  for (const candidate of [name, ...aliases]) {
    const value = process.env[candidate] || fromDotenv(candidate) || fromZshrc(candidate);
    if (value) return value;
  }
  throw new Error(`${name} is not set. Export it or put it in a .env file above this directory.`);
}
