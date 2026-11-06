import registry from '../../registry/models.json';
import examples from '../../registry/examples.json';

export type Lang = 'zh' | 'en';
type Localized = { zh: string; en: string };
export type Release = {
  id: string; label: string; createdAt: string; modelProtocol: number; packageFormat: number;
  ppoIteration: number; bcIteration: number; format: string; sizeBytes: number | null;
  sha256: string | null; url: string | null; attachments: string[]; notes: Localized;
  sourceUrl?: string; primaryArtifact?: string; technical?: Record<string, any>;
};
export type Model = {
  id: string; slug: string; name: string; author: {name: string; github: string | null};
  summary: Localized; description: Localized; tags: string[];
  category: 'general' | 'specialist' | 'lightweight'; accent: 'violet' | 'amber' | 'teal';
  featured: boolean; updatedAt: string; license: string; example: boolean; releases: Release[];
};
export const demoMode = import.meta.env.DEV || import.meta.env.PUBLIC_DEMO_MODE === 'true';
export const models: Model[] = [...registry.models, ...(demoMode ? examples.models : [])] as Model[];
export const text = (lang: Lang, zh: string, en: string) => lang === 'zh' ? zh : en;
export const path = (lang: Lang, route = '') => `/${lang}/${route ? route.replace(/^\/+|\/+$/g, '') + '/' : ''}`;
export const categories = [
  { id: 'all', zh: '全部模型', en: 'All models' },
  { id: 'general', zh: '通用对局', en: 'Generalist' },
  { id: 'specialist', zh: '专项训练', en: 'Specialist' },
  { id: 'lightweight', zh: '轻量部署', en: 'Lightweight' },
];
export function formatBytes(size: number | null, lang: Lang) {
  if (size === null) return text(lang, '未提供', 'Not provided');
  return size >= 1073741824 ? `${(size / 1073741824).toFixed(2)} GiB` : `${(size / 1048576).toFixed(1)} MiB`;
}
