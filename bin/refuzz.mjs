#!/usr/bin/env node
// The CLI is TypeScript run as is: tsx loads it, so there is no build step.
import { register } from 'tsx/esm/api';

register();
await import('../src/cli.ts');
