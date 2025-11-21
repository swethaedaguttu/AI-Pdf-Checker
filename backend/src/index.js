import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { Mistral } from '@mistralai/mistralai';
import { PDFParse } from 'pdf-parse';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const trimmedOpenAiKey = process.env.OPENAI_API_KEY?.trim();
const trimmedMistralKey = process.env.MISTRAL_API_KEY?.trim();
const trimmedGroqKey = process.env.GROQ_API_KEY?.trim();
const providerPreference = process.env.LLM_PROVIDER?.toLowerCase();

let activeProvider = 'heuristic';
let activeModel = 'heuristic';
let openai = null;
let mistral = null;
let groq = null;

const resolveOpenAI = () => {
  if (!trimmedOpenAiKey) {
    return;
  }
  openai = new OpenAI({ apiKey: trimmedOpenAiKey });
  activeProvider = 'openai';
  activeModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
};

const resolveMistral = () => {
  if (!trimmedMistralKey) {
    return;
  }
  mistral = new Mistral({ apiKey: trimmedMistralKey });
  activeProvider = 'mistral';
  activeModel = process.env.MISTRAL_MODEL || 'mistral-medium-latest';
};

const resolveGroq = () => {
  if (!trimmedGroqKey) {
    return;
  }
  groq = new OpenAI({
    apiKey: trimmedGroqKey,
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  });
  activeProvider = 'groq';
  activeModel = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
};

if (providerPreference === 'openai') {
  resolveOpenAI();
} else if (providerPreference === 'mistral') {
  resolveMistral();
} else if (providerPreference === 'groq') {
  resolveGroq();
} else if (trimmedOpenAiKey) {
  resolveOpenAI();
} else if (trimmedMistralKey) {
  resolveMistral();
} else if (trimmedGroqKey) {
  resolveGroq();
}

console.log(`LLM provider: ${activeProvider}`);

app.use(cors());
app.use(express.json());

const sentenceSplitter = (text) =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

const buildFallbackResult = (rule, documentText) => {
  const cleanRule = rule.trim();
  const text = documentText.toLowerCase();
  const words = cleanRule.toLowerCase().match(/[a-z0-9]+/g) || [];
  const keywords = words.filter((word) => word.length > 4).slice(0, 6);
  const matches = keywords.filter((keyword) => text.includes(keyword));
  const threshold = Math.max(1, Math.ceil(keywords.length * 0.4));
  const status = matches.length >= threshold ? 'pass' : 'fail';
  const sentences = sentenceSplitter(documentText);
  const evidenceSentence =
    matches.length > 0
      ? sentences.find((sentence) =>
          matches.some((keyword) =>
            sentence.toLowerCase().includes(keyword.toLowerCase())
          )
        )
      : null;

  return {
    rule: cleanRule,
    status,
    evidence: evidenceSentence || 'No direct evidence found.',
    reasoning:
      status === 'pass'
        ? `Heuristic match for keywords: ${matches.join(', ') || 'n/a'}.`
        : 'Keywords from the rule were not found in the document text.',
    confidence: status === 'pass' ? 55 : 35,
    source: 'heuristic',
  };
};

const parseLLMJson = (content, fallback, source = 'llm') => {
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return fallback;
    }
    const parsed = JSON.parse(content.slice(start, end + 1));
    return {
      rule: fallback.rule,
      status: parsed.status?.toLowerCase() === 'pass' ? 'pass' : 'fail',
      evidence: parsed.evidence || fallback.evidence,
      reasoning: parsed.reasoning || fallback.reasoning,
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.min(100, Math.max(0, Math.round(parsed.confidence)))
          : fallback.confidence,
      source,
    };
  } catch (error) {
    return fallback;
  }
};

const extractGroqText = (response) => {
  if (!response) {
    return '';
  }
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }
  if (Array.isArray(response.output_text)) {
    return response.output_text.join('\n');
  }
  if (Array.isArray(response.output)) {
    return response.output
      .map((item) =>
        Array.isArray(item?.content)
          ? item.content
              .map((chunk) => chunk?.text?.value || chunk?.text || '')
              .join('')
          : ''
      )
      .join('\n');
  }
  return '';
};

const evaluateRuleWithLLM = async (rule, documentText, provider) => {
  const effectiveProvider = provider || activeProvider;

  if (effectiveProvider === 'heuristic' || (!openai && !mistral && !groq)) {
    return buildFallbackResult(rule, documentText);
  }

  const fallback = buildFallbackResult(rule, documentText);
  const prompt = `
You are validating whether a PDF document satisfies a specific rule.
Return strict JSON with the keys: status ("pass" or "fail"), evidence (short quote),
reasoning (one sentence), confidence (0-100 integer).

Rule: "${rule}"
Document text:
"""
${documentText}
"""
JSON Response:
`;

  try {
    if (effectiveProvider === 'openai' && openai) {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You evaluate business documents against simple compliance rules.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const content = completion.choices?.[0]?.message?.content;
      if (!content) {
        return fallback;
      }

      return parseLLMJson(content, fallback, 'openai');
    }

    if (effectiveProvider === 'mistral' && mistral) {
      const completion = await mistral.chat.complete({
        model: process.env.MISTRAL_MODEL || 'mistral-medium-latest',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      });

      const messageContent = completion.choices?.[0]?.message?.content;
      let content = '';
      if (typeof messageContent === 'string') {
        content = messageContent;
      } else if (Array.isArray(messageContent)) {
        content = messageContent
          .map((chunk) => ('text' in chunk ? chunk.text : chunk?.content ?? ''))
          .join('\n');
      }

      if (!content) {
        return fallback;
      }

      return parseLLMJson(content, fallback, 'mistral');
    }

    if (effectiveProvider === 'groq' && groq) {
      const response = await groq.responses.create({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        input: [
          {
            role: 'system',
            content:
              'You evaluate business documents against simple compliance rules.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      });

      const content = extractGroqText(response);
      if (!content) {
        return fallback;
      }

      return parseLLMJson(content, fallback, 'groq');
    }

    return fallback;
  } catch (error) {
    console.error('LLM evaluation error:', error.message);
    return fallback;
  }
};

const extractTextFromPdf = async (fileBuffer) => {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const textResult = await parser.getText();
    const cleanedText =
      textResult.text
        ?.replace(/\s+/g, ' ')
        .replace(/\u0000/g, '')
        .trim() || '';

    return {
      text: cleanedText,
      pageCount: textResult.total || null,
    };
  } finally {
    await parser.destroy();
  }
};

const truncateText = (text, limit = 12000) =>
  text.length > limit ? text.slice(0, limit) : text;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/check', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required.' });
    }

    const rawRules = req.body.rules;
    const rawProvider = req.body.provider;

    if (!rawRules) {
      return res.status(400).json({ message: 'At least one rule is required.' });
    }

    let rules = [];
    if (Array.isArray(rawRules)) {
      rules = rawRules;
    } else {
      try {
        rules = JSON.parse(rawRules);
      } catch {
        rules = [rawRules];
      }
    }

    const normalizedRules = rules
      .map((rule) => (typeof rule === 'string' ? rule.trim() : ''))
      .filter(Boolean)
      .slice(0, 10);

    if (normalizedRules.length === 0) {
      return res.status(400).json({ message: 'Rules must be non-empty text.' });
    }

    const allowedProviders = new Set(['groq', 'mistral', 'openai', 'heuristic']);
    const requestedProvider =
      typeof rawProvider === 'string'
        ? rawProvider.toLowerCase().trim()
        : undefined;

    const effectiveProvider =
      requestedProvider && allowedProviders.has(requestedProvider)
        ? requestedProvider
        : activeProvider;

    const { text, pageCount } = await extractTextFromPdf(req.file.buffer);
    const documentText = truncateText(text);

    if (!documentText) {
      return res
        .status(422)
        .json({ message: 'Could not extract text from the PDF.' });
    }

    const evaluations = await Promise.all(
      normalizedRules.map((rule) =>
        evaluateRuleWithLLM(rule, documentText, effectiveProvider)
      )
    );

    const resolvedModel =
      effectiveProvider === 'groq'
        ? process.env.GROQ_MODEL || 'openai/gpt-oss-20b'
        : effectiveProvider === 'mistral'
        ? process.env.MISTRAL_MODEL || 'mistral-medium-latest'
        : effectiveProvider === 'openai'
        ? process.env.OPENAI_MODEL || 'gpt-4o-mini'
        : 'heuristic';

    return res.json({
      meta: {
        pageCount,
        model: resolvedModel,
        textLength: documentText.length,
      },
      results: evaluations,
    });
  } catch (error) {
    console.error('PDF check failed:', error);
    return res.status(500).json({
      message: 'An unexpected error occurred while checking the document.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`PDF checker backend listening on http://localhost:${PORT}`);
});

