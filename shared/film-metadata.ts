export interface FilmMetadata {
  originalLanguage?: string;
  productionCountries: { code: string; name: string }[];
}

// Whitelist display fields; never pass matching records to the public view. 展示字段使用白名单，不把匹配记录传给公开界面。
export function filmMetadataView(metadata: FilmMetadata, audience: 'public' | 'local') {
  const language = metadata.originalLanguage ? { originalLanguage: metadata.originalLanguage } : {};
  return audience === 'local' ? { ...language, productionCountries: metadata.productionCountries.map((c) => ({ code: c.code, name: c.name })) } : language;
}
