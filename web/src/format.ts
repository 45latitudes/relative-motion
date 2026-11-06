// Formats an ISO date or timestamp as a Chinese calendar date, e.g. 2026 年 8 月 20 日.
export function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}
