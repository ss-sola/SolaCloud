const entry = process.env.npm_execpath;
const isScript = entry && /\.[cm]?js$/i.test(entry);
const isExecutable = entry && /\.exe$/i.test(entry);
const windowsWrapper = process.platform === 'win32' && !isScript && !isExecutable;

// pnpm run 提供当前 pnpm 的入口，直接交给 Node 可保留 Windows 路径和参数边界。
export const pnpmCommand = isScript
  ? process.execPath
  : isExecutable
    ? entry
    : windowsWrapper
      ? 'pnpm.cmd'
      : 'pnpm';
export const pnpmArguments = isScript ? [entry] : [];
export const pnpmShell = windowsWrapper;
