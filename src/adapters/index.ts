/**
 * Every language perch scans, and the adapter that runs it. An adapter is loaded only when a project has that language.
 */
import type { Adapter } from '../types.ts';

const ADAPTERS: Record<string, () => Promise<Adapter>> = {
  python: async () => (await import('./python.ts')).python,
  javascript: async () => (await import('./javascript.ts')).javascript,
  typescript: async () => (await import('./javascript.ts')).javascript,
  tsx: async () => (await import('./javascript.ts')).javascript,
  rust: async () => (await import('./rust.ts')).rust,
  go: async () => (await import('./go.ts')).go,
  java: async () => (await import('./jvm.ts')).jvm,
  kotlin: async () => (await import('./jvm.ts')).jvm,
  scala: async () => (await import('./jvm.ts')).jvm,
  groovy: async () => (await import('./jvm.ts')).jvm,
  c: async () => (await import('./c.ts')).c,
  cpp: async () => (await import('./c.ts')).c,
  c_sharp: async () => (await import('./csharp.ts')).csharp,
  ruby: async () => (await import('./ruby.ts')).ruby,
  php: async () => (await import('./php.ts')).php,
  lua: async () => (await import('./lua.ts')).lua,
  swift: async () => (await import('./swift.ts')).swift,
  zig: async () => (await import('./zig.ts')).zig,
  solidity: async () => (await import('./solidity.ts')).solidity,
  bash: async () => (await import('./bash.ts')).bash,
};

export const LANGUAGES = Object.keys(ADAPTERS);

export async function adapterFor(language: string): Promise<Adapter | null> {
  const load = ADAPTERS[language];
  if (!load) return null;
  try {
    return await load();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
}
