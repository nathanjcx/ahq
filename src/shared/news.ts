export const AI_NEWS_ACCOUNTS = ['OpenAI', 'AnthropicAI', 'GoogleDeepMind', 'xAI', 'MistralAI', 'huggingface', 'sama', 'karpathy', '_akhaliq', 'swyx'] as const;
export interface NewsItem {
  account: string; url: string; publishedAt: string;
  kind: 'announcement' | 'rumor'; title: string; summary: string;
}
export interface NewsCollection {
  since: string; until: string;
  coverage: Array<{ account: string; status: 'checked' | 'partial' | 'unavailable'; note: string }>;
  items: NewsItem[];
  excluded: number;
}
