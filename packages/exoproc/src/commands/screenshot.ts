export interface ScreenshotCliOptions {
  outputPath?: string;
  pid?: number;
  hwnd?: string;
  title?: string;
}

export async function commandScreenshot(
  options: ScreenshotCliOptions,
): Promise<void> {
  const { takeScreenshot } = await import('exoproc-mcp');
  const result = await takeScreenshot({
    outputPath: options.outputPath,
    pid: options.pid,
    hwnd: options.hwnd,
    title: options.title,
  });

  if (result.success) {
    console.log(
      `\nScreenshot saved: ${result.filePath} (${result.width}x${result.height})`,
    );
    console.log();
  } else {
    console.error(`\nFailed to capture screenshot:`, result);
  }
}
