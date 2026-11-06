import { array, FIELDS, object, type Row, type Status } from './model.ts';
import type { RequestAudit } from './audit.ts';

const names: Record<string, string> = {
  tmdbMatch: 'TMDb 身份确认', englishTitle: '英文片名', originalTitle: '原语言片名', chineseTitle: '中文片名',
  originalLanguage: '原片语言', year: '发行年份', runtime: '片长', directors: '导演', cast: '主演', genres: '类型', overview: 'TMDb 简介',
  tmdbRating: 'TMDb 评分', poster: '海报 URL', trailer: '预告片外跳链接', wikidataMatch: 'Wikidata ID 交叉匹配',
  imdbId: 'Wikidata IMDb ID', doubanId: '豆瓣 ID', rottenTomatoesId: '烂番茄电影 ID', metacriticId: 'Metacritic 电影 ID',
  letterboxdId: 'Letterboxd 电影 ID', awards: 'P166 获奖／荣誉声明', nominations: 'P1411 提名声明',
  p444: 'P444 非弃用声明', p444Usable: 'P444 可消歧量尺与口径', p444Dated: '可用 P444 含明确日期',
  wikipediaEn: '英文维基百科剧情', wikipediaZh: '中文维基百科剧情', imdbRating: '本地 IMDb ratings 命中',
};
const statuses: Record<Status, string> = { hit: '命中', miss: '未命中', ambiguous: '未确认（歧义）', untested: '未测', error: '错误' };
const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function summarize(rows: Row[], field: string) {
  const counts = { hit: 0, miss: 0, ambiguous: 0, untested: 0, error: 0 };
  rows.forEach((row) => counts[row.fields[field].status]++);
  return { ...counts, total: rows.length, measured: counts.hit + counts.miss + counts.ambiguous };
}
export function report(rows: Row[], input: {
  observedFrom: string; observedTo: string; requestCount: number; ratingsSha256: string; ratingsRows: number; ratingsInvalid: number;
  requestAudit?: RequestAudit;
}) {
  const output = ['# T-05 · 20 部影片覆盖率实测', '',
    '> 本报告由 `pipeline/scripts/coverage.ts` 生成；数字全部来自逐片结果。真实响应、文本、分数和匹配候选仅保存在 `local/t05/`。', '',
    '## 方法与范围', '',
    `- 固定选样 ${rows.length} 部，来自指定侦察包的 UA／CI／CA 记录；包标注观测日为 2026-08-20，片单所属月份未推断。选样索引与字段提取见 \`pipeline/coverage/samples.ts\`。`,
    `- 本次读取的补全响应时间范围：${input.observedFrom} 至 ${input.observedTo}；本次重算使用 ${input.requestCount} 个不同缓存响应。${input.requestAudit ? `请求间隔审查扫描目录中保留的全部 ${input.requestAudit.domains.reduce((total, domain) => total + domain.requests, 0)} 个响应记录，包含本次未使用的历史请求，两处统计范围不同。` : ''}`,
    '- 自动匹配采用 [静态证据模型](matching.md)：输出确认／未确认及原因。译名用于召回，来源明确的原语言片名参与身份约束；同名同导演、完整导演拼音加片长、相邻年份加片长和独立辅助依据构成确认路径。明确冲突阻止确认，候选须领先 12 分；证据分不是概率。搜索限每查询 5 页、合计 200 个候选，截断只允许唯一明确导演锚点通过。未确认条目保留航司信息，不挂资料或评分。',
    '- 原片语言与航司音轨分开：有独立原片语言依据才计完整辅助分，音轨吻合只计弱证据。制片国家／地区仅在本地证据中按明确标准代码静默比较；本批航司未提供该字段，地区辅助未获真实样本验证。公开展示投影只含原片语言，私人本地投影包含两者，实际页面接入留后续阶段。',
    '- Wikidata 用已确认 TMDb／IMDb ID 交叉确认；电影 ID 先过滤前缀再按 rank 选值。P444 按机构及口径分组后选 rank、唯一最新日期；映射与日期不明均保留问题。P166 与 P1411 分开。',
    '- 多值字段按每部影片是否至少有一条可用值统计，未采纳声明仍列入问题清单。英文片名只计英语原名或明确英语翻译，接口语言回落不作语言确认。',
    '- 维基百科只检查 en／zh 的已识别剧情小节，以固定修订保留 wikitext、文章链接与站点许可；标题识别在本地归一化常用繁简字形并支持剧情／故事简介等写法，正文保持原样。逐页附加署名、正文纯文本化与展示尚未验收。预告片先查英语，未命中时补查影片原语言；海报和预告片统计 URL 可生成性，未请求媒体文件或验证外站播放。',
    `- IMDb 仅在本地流式解析用户文件：${input.ratingsRows} 行，${input.ratingsInvalid} 行格式无效；文件 SHA-256：\`${input.ratingsSha256}\`。文件载入时间不是评分日期，未向外发送文件或查表结果。`,
    '- 下游字段前置匹配失败时标为「未测」，不当作来源字段缺失。总体覆盖率分母固定为 20；可判定分母只含命中、未命中及歧义，错误和未测另列。', '',
    '## 逐片结果', '', '| 编号 | 来源片名 | 航司 | 年份 | 样本分层 | TMDb | Wikidata | 英文剧情 | 中文剧情 | IMDb |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) output.push(`| ${[row.sample.id, row.sample.title, row.sample.airline, row.sample.year ?? '未知', row.sample.tags.join('、'),
    ...['tmdbMatch', 'wikidataMatch', 'wikipediaEn', 'wikipediaZh', 'imdbRating'].map((f) => f === 'tmdbMatch' ? row.fields[f].status === 'hit' ? '确认' : '未确认' : statuses[row.fields[f].status])].map(cell).join(' | ')} |`);
  output.push('', '## 字段覆盖率', '', '| 字段 | 命中／总样本 | 总体覆盖 | 可判定样本 | 未命中 | 歧义 | 未测 | 错误 |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const field of FIELDS) {
    const c = summarize(rows, field);
    output.push(`| ${names[field]} | ${c.hit}/${c.total} | ${c.measured ? `${(100 * c.hit / c.total).toFixed(1)}%` : '未测'} | ${c.measured} | ${c.miss} | ${c.ambiguous} | ${c.untested} | ${c.error} |`);
  }
  output.push('', '## 匹配证据', '', '分项、候选编号和原始比较资料保留本地；这里展示已确认候选的主要证据状态，未确认时展示最高同名候选，不展示国家／地区。', '',
    '| 编号 | 证据分 | 候选领先 | 排除的冲突同名候选 | 导演 | 片长 | 年份 |', '| --- | --- | --- | --- | --- | --- | --- |');
  const signalNames: Record<string, string> = { match: '吻合', near: '相近', phonetic: '完整拼音对应', unknown: '未知', different: '不同', conflict: '冲突' };
  for (const row of rows) {
    const audit = object(row.details.matchAudit);
    const candidates = array(audit.candidates).map(object);
    const matchedId = object(object(row.details.tmdb).movie).id;
    const candidate = candidates.find((c) => matchedId !== undefined && c.id === matchedId)
      ?? candidates.find((c) => object(object(c.vector).title).state === 'match');
    const vector = object(candidate?.vector);
    const margin = audit.margin ?? (audit.viableCandidates === 1 ? '无其他无冲突同名候选' : '不适用');
    output.push(`| ${row.sample.id} | ${candidate?.score ?? '未判定'} | ${margin} | ${audit.excludedNamesakes ?? 0} | ${['director', 'runtime', 'year'].map((k) => signalNames[String(object(vector[k]).state)] ?? '未知').join(' | ')} |`);
  }
  output.push('', '## 未确认原因与数据诊断', '');
  for (const row of rows) {
    const problems = Object.entries(row.fields).filter(([key, value]) => ['ambiguous', 'error'].includes(value.status) || key === 'tmdbMatch' && value.status !== 'hit');
    const notes = [...new Set([...row.notes.filter((note) => !problems.some(([, value]) => value.reason === note)),
      ...problems.map(([key, value]) => `${names[key]}：${value.reason}`)])];
    if (notes.length) output.push(`- ${cell(row.sample.id)} ${cell(row.sample.title)}：${notes.map(cell).join('；')}。`);
  }
  output.push(`- 跨来源外部 ID 冲突：${rows.filter((row) => row.details.idConflict).length} 部。这是数据异常信号，不等于已证实误配；冲突关联停止挂载。`);
  output.push('- 航空版本：样本均未明确声明删改版，片长差异不能单独证明航空删改；只保留差异与来源信息，不推断剪辑原因。',
    '- 奖项：本次统计非弃用的获奖／荣誉和提名声明，不把所有 P166 都标为竞赛奖；奖项类别和限定符展示留待结构升级。', '',
    '## 溯源与复现', '', '| 编号 | 原文件 | 记录索引／标识 | SHA-256 |', '| --- | --- | --- | --- |');
  rows.forEach(({ sample: s }) => output.push(`| ${s.id} | ${s.source} | ${cell(s.sourceRecord)} | ${s.sourceSha256} |`));
  if (input.requestAudit) {
    output.push('', '## 请求间隔审查', '',
      `按保存的请求开始时间计算；只有明确带 \`ratePolicy=${input.requestAudit.policy}\` 的响应才计入策略证据，首次标记时间为 ${input.requestAudit.markedFrom ?? '尚无带标记响应'}。旧响应未标记策略，仍保留历史间隔观测；初轮百科子域限速偏差不会由后续策略标记覆盖。策略间隔取带标记请求距其上一条同域请求的时间差。`, '',
      '| 域名 | 累计请求 | 全历史最小间隔（秒） | 无当前策略标记 | 有策略标记 | 策略请求距上次同域最小间隔（秒） |', '| --- | --- | --- | --- | --- | --- |');
    for (const r of input.requestAudit.domains) output.push(`| ${r.domain} | ${r.requests} | ${r.minGapSeconds?.toFixed(3) ?? '不足两次'} | ${r.unmarkedRequests} | ${r.markedRequests} | ${r.markedMinGapSeconds?.toFixed(3) ?? '不足两次'} |`);
  }
  output.push('', '从仓库根目录运行，先将指定侦察包放入 `data/raw/ife-scout-20260820/`、用户 ratings 文件放入 `local/t05/title.ratings.tsv.gz`（或解压后的 `title.ratings.tsv`，两者都有时优先 gzip）；维护者凭据存 `.env`。', '',
    '```sh', 'node --env-file=.env pipeline/scripts/coverage.ts --fetch', 'node pipeline/scripts/coverage.ts', 'pnpm test', 'pnpm -C web build', '```', '',
    '首条命令只采集缺少缓存的登记补全端点；第二条全程离线重算。失败响应不自动重试，需先核查本地响应与来源状态。原始数据及评分不作为测试夹具，自动化测试只读 `fixtures/` 中自造数据。', '',
    '## 后续验证边界', '',
    '浏览器 Worker、手机性能、IMDb 持久化、维基百科文本展示与逐页署名、公开导出和 TMDb 缓存期限属于后续阶段；本报告不代表这些能力已验收。技术覆盖与条款待确认项分别见本报告及 [sources](sources.md)。', '');
  return output.join('\n');
}
