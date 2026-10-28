export interface ExecCliOptions {
  code: string;
  pid?: number;
  json?: boolean;
}

export async function commandExec(options: ExecCliOptions): Promise<void> {
  const { executeLocalCode, executeCode, openAccessor, closeAccessor } =
    await import('exoproc-mcp');
  if (options.pid) {
    const session = await openAccessor({ pid: options.pid });
    try {
      const res = await executeCode({
        session: session.sessionId,
        code: options.code,
      });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      if (res.logs && res.logs.length > 0) {
        console.log(res.logs.join('\n'));
      }
      if (res.result !== undefined && res.result !== null) {
        console.log(JSON.stringify(res.result, null, 2));
      }
    } finally {
      await closeAccessor({ session: session.sessionId });
    }
  } else {
    const res = await executeLocalCode({ code: options.code });
    if (options.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (res.logs && res.logs.length > 0) {
      console.log(res.logs.join('\n'));
    }
    if (res.result !== undefined && res.result !== null) {
      console.log(JSON.stringify(res.result, null, 2));
    }
  }
}
