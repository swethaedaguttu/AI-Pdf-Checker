export type RuleStatus = 'pass' | 'fail';

export interface RuleResult {
  rule: string;
  status: RuleStatus;
  evidence: string;
  reasoning: string;
  confidence: number;
  source?: string;
}

export interface CheckResponse {
  meta: {
    pageCount: number | null;
    model: string;
    textLength: number;
  };
  results: RuleResult[];
}

