// Synthetic API responses and failure inputs for review regressions. 审查回归使用的自造响应与失败输入。
export const missingMovie = { success: false, status_code: 34, status_message: 'Synthetic missing movie. 自造缺失影片。' };
export const rejectedRequest = { success: false, status_code: 7 };
export const plotHeadings = ['故事簡介', '劇情簡介', '劇情梗概', '故事梗概', '剧情简介', '故事大綱', 'Premise', 'Plot summary'];
export const invalidClocks = ['{', 'null', '[]', '{"wikipedia.org":null}'];
export const originalVideos = { results: [{ type: 'Trailer', site: 'YouTube', key: 'synthetic-original', iso_639_1: 'de' }] };
export const unknownFailure = 'Synthetic sensitive headers. 自造敏感请求头。';
export const searchCases = [
  { missingYear: true, pages: 0, count: 0, status: 'miss', reason: '未找到片名或译名一致的候选' },
  { missingYear: false, pages: 0, count: 0, status: 'miss', reason: '未找到片名或译名一致的候选' },
  { missingYear: false, pages: 6, count: 1, status: 'ambiguous', reason: '候选搜索不完整，未取得唯一明确导演佐证' },
  { missingYear: true, pages: 6, count: 1, status: 'ambiguous', reason: '候选搜索不完整，未取得唯一明确导演佐证' },
  { missingYear: true, pages: 6, count: 0, status: 'ambiguous', reason: '候选搜索不完整，未取得唯一明确导演佐证' },
];
export const cantoneseTitles = [
  { original_language: 'cn', original_title: '紙上地平線', translations: {} },
  { original_language: 'en', original_title: 'Paper Horizon', translations: { translations: [{ iso_639_1: 'cn', data: { title: '紙上地平線' } }] } },
];
export const auditRecords = [
  { url: 'https://api.themoviedb.org/3/search/movie?primary_release_year=2001', fetchedAt: '2026-01-01T00:00:00.000Z', status: 200, data: {} },
  { url: 'https://en.wikipedia.org/w/api.php?page=synthetic', fetchedAt: '2026-01-01T00:00:01.000Z', status: 200, data: {} },
  { url: 'https://zh.wikipedia.org/w/api.php?page=synthetic', fetchedAt: '2026-01-01T00:00:01.200Z', status: 200, data: {} },
  { url: 'https://en.wikipedia.org/w/api.php?page=synthetic2', fetchedAt: '2026-01-01T00:00:03.300Z', status: 200, data: {}, ratePolicy: 'registrable-domain-2100ms' },
];
