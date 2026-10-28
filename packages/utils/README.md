# exoproc-utils

Shared utilities, error classes, and logger configurations for the Exoproc ecosystem. Built on Winston, it supports level-filtered file logging and environment-driven configuration.

## Installation

```bash
bun add exoproc-utils
```

## Quick Start

```typescript
import { Logger } from 'exoproc-utils';

// Instantiate package-level logger
export const log = new Logger('MyModule');

// Write log entries
log.info('Service started');
log.debug('Variable value:', { x: 42 });
log.warn('Execution delayed');
```

## Features

- **Winston Logger Wrapper**: Simple log level filtering (`debug`, `info`, `warn`, `error`, `fatal`).
- **Dynamic File Rotation**: Writes log files under `logs/` directory automatically with daily log rotation.
- **Environment Integration**: Integrates with `dotenv` to load `.env` variables and automatically configure logging levels using `EXOPROC_LOG_LEVEL`.
