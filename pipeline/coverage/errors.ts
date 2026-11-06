// Only curated project messages are safe for operator output. 仅项目内预定义信息可直接输出给操作者。
export class CoverageError extends Error {}
export function diagnostic(error: unknown): string {
  return error instanceof CoverageError ? error.message
    : 'Coverage run stopped; inspect local inputs and evidence. 覆盖率任务停止，请核对本地输入与证据。';
}
