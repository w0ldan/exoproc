import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const bunFfiBindingUrl = pathToFileURL(
  path.join(packageRoot, 'src/host/node-bun-ffi-binding.ts'),
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'bun:ffi') {
      return { url: bunFfiBindingUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
