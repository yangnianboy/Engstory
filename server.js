require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const KIMI_KEY = process.env.KIMI_API_KEY;
const PORT = process.env.PORT || 3456;

// ========== API 代理 ==========

// 1. 故事生成 → DeepSeek（最多重试 1 次）
app.post('/api/generate-story', async (req, res) => {
  try {
    const { words } = req.body;
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: '请提供生词列表' });
    }

    let parsed, validation;
    const MAX_ATTEMPTS = 2;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const isRetry = attempt > 0;
      const prompt = buildStoryPrompt(words, isRetry ? validation?.reason : null);
      const result = await callDeepSeek(prompt, {
        max_tokens: 32768,                           // 推理链 + 800-1000 词故事，给足空间
        thinking: { type: 'enabled' },               // 启用思考模式提升故事质量
      });
      parsed = parseStoryResponse(result);
      validation = validateStoryFormat(parsed.body, words);
      if (validation.valid) break;
      console.log(`故事格式校验失败 (第${attempt + 1}次)：${validation.reason}，${isRetry ? '已放弃' : '准备重试'}`);
    }

    if (!validation.valid) {
      throw new Error(`格式校验失败：${validation.reason}，请重试`);
    }
    res.json(parsed);
  } catch (err) {
    console.error('生成故事失败:', err.message);
    res.status(500).json({ error: err.message || '故事生成失败，请重试' });
  }
});

// 2. 整篇翻译 → DeepSeek（全文送入，保持上下文连贯，按句输出 JSON）
app.post('/api/translate', async (req, res) => {
  try {
    const { storyBody, sentenceCount } = req.body;
    if (!storyBody || !sentenceCount) {
      return res.status(400).json({ error: '请提供故事全文和句数' });
    }

    let translations = [];
    // 最多尝试 3 次，确保句数匹配
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = buildTranslationPrompt(storyBody, sentenceCount);
      const result = await callDeepSeek(prompt, {
        model: 'deepseek-v4-flash',
        max_tokens: 4096,
        temperature: 0.3,
        thinking: { type: 'disabled' },
      });
      translations = parseTranslationResponse(result);
      if (translations.length === sentenceCount) break;
      console.log(`翻译句数不匹配：期望 ${sentenceCount}，实际 ${translations.length}，重试第 ${attempt + 1} 次`);
    }

    // 补齐或截断
    while (translations.length < sentenceCount) translations.push('');
    if (translations.length > sentenceCount) translations = translations.slice(0, sentenceCount);

    res.json({ translations });
  } catch (err) {
    console.error('翻译失败:', err.message);
    res.status(500).json({ error: err.message || '翻译失败，请重试' });
  }
});

// 3. 图片 OCR → Kimi
app.post('/api/ocr', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: '请提供图片 base64 数据' });
    }

    const words = await callKimiOCR(image);
    res.json({ words });
  } catch (err) {
    console.error('OCR 失败:', err.message);
    res.status(500).json({ error: err.message || '图片识别失败，请重试' });
  }
});

// ========== API 调用函数 ==========

async function callDeepSeek(userPrompt, opts = {}) {
  const body = {
    model: opts.model || 'deepseek-v4-pro',
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: opts.max_tokens || 4096,
  };

  // temperature: thinking 模式下会被忽略，仅非 thinking 模式生效
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }

  // thinking: 显式传入才设置
  // 创意写作建议关闭（thinking 会消耗 max_tokens 配额用于推理链，导致正文输出不足）
  if (opts.thinking) {
    body.thinking = opts.thinking;
  }

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `DeepSeek API 错误 (${resp.status})`);
  }

  const data = await resp.json();
  const content = data.choices[0].message.content || '';

  // 调试日志：响应异常时打印详细信息
  if (!content || content.length < 50) {
    console.log('⚠️ DeepSeek 响应异常 ——');
    console.log('  content 长度:', content.length);
    console.log('  content 预览:', content.substring(0, 200));
    if (data.choices[0].message.reasoning_content) {
      console.log('  reasoning_content 长度:', data.choices[0].message.reasoning_content.length);
    }
    if (data.usage) {
      console.log('  usage:', JSON.stringify(data.usage));
    }
  }

  return content;
}

async function callKimiOCR(base64Image) {
  const resp = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KIMI_KEY}`,
    },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: base64Image,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: '请识别图片中的所有英语单词，每行识别一个，只返回单词列表，不要有其他内容。如果有重复的单词，只保留一个。',
            },
          ],
        },
      ],
      max_tokens: 1024,
      temperature: 1,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Kimi API 错误 (${resp.status})`);
  }

  const data = await resp.json();
  const text = data.choices[0].message.content.trim();
  return text
    .split(/[,，\n]/)
    .map(w => w.replace(/[^\w\s-]/g, '').trim())
    .filter(w => w.length > 0 && /[a-zA-Z]/.test(w));
}

// ========== 提示词构建 ==========

function buildStoryPrompt(words, retryReason) {
  const wordList = words.join(', ');
  const retryNote = retryReason
    ? `\n\n!!! RETRY: Previous output REJECTED. Reason: ${retryReason}\nPay extra attention to the FORMAT RULES below.`
    : '';

  return `You are a native English columnist. Write an 800-1000 word article that naturally uses ALL of my target vocabulary words. My English level is ~3500 words (high school); do NOT use other advanced words beyond my level.

TARGET WORDS (must ALL appear): ${wordList}

WRITING RULES:
- Pick a theme (short story, science article, opinion piece) that fits these words naturally.
- Integrate every target word seamlessly -- no forced sentences just to use a word.
- Mark target words with **bold** (e.g. **dilapidated**).
- Use only high-school-level English for all other vocabulary.

============================================
CRITICAL OUTPUT FORMAT -- VIOLATIONS WILL BE REJECTED
============================================

You MUST output in EXACTLY this structure:

TITLE: [English Title Here]

ARTICLE:
One sentence per line.
Another sentence on its own line.
A third sentence alone on its own line.

[blank line between paragraphs]
Start of a new paragraph.
Continue with one sentence per line.

--- FORMAT RULES (read carefully) ---

[1] ONE SENTENCE PER LINE. This is the #1 rule.
    WRONG: "The sun rose. Birds sang. I woke up."  <-- 3 sentences on 1 line = REJECTED
    RIGHT:
    The sun rose.
    Birds sang.
    I woke up.

[2] Every line inside ARTICLE must be exactly ONE English sentence.
    After a period, question mark, or exclamation mark -> NEW LINE.

[3] Separate paragraphs with ONE empty line. Do NOT use indentation or extra spacing.

[4] Start with "TITLE:" on the first line, then "ARTICLE:" before the story body.
    Never output "TITLE:" and "ARTICLE:" on the same line.

[5] Wrap EVERY target vocabulary word in **double asterisks**.

[6] The article body must be 800-1000 words (roughly 30-60 lines).

--- OUTPUT EXAMPLE ---
TITLE: The Last Garden

ARTICLE:
The old **greenhouse** stood forgotten behind the abandoned school.
Its glass panels were cracked, and ivy had claimed every surface.
Nobody in town remembered who had built it.

But Emily was different.
Her **curiosity** drove her to explore places others ignored.
She pushed open the rusted door and stepped inside.

--- BEFORE YOU OUTPUT: VERIFY ---
Mentally check each item below. If ANY check fails, FIX IT before responding:
[*] Does every line after ARTICLE contain exactly ONE sentence?
[*] Did I wrap ALL target words in **bold**?
[*] Is the total length 800-1000 words?
[*] Are paragraphs separated by blank lines?
[*] Does the output start with "TITLE:" and include "ARTICLE:"?

Format errors waste time. Get it right the first time.${retryNote}`;
}

function buildTranslationPrompt(storyBody, sentenceCount) {
  // 去掉生词 **粗体** 标记，避免翻译中残留 markdown 符号
  const cleanBody = storyBody.replace(/\*\*/g, '');

  return `请先通读以下英文故事的全文，理解上下文和行文风格，然后将它翻译成地道流畅的中文。

要求：
1. 必须翻译为恰好 ${sentenceCount} 个中文句子，对应原文的每个自然句
2. 只返回一个 JSON 字符串数组，格式为：["句子1译文", "句子2译文", ...]
3. 不要输出任何其他内容

英文故事全文：
${cleanBody}`;
}

// ========== 格式校验 ==========

function validateStoryFormat(body, words) {
  if (!body || body.trim().length === 0) {
    return { valid: false, reason: '故事正文为空' };
  }

  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const wordCount = body.replace(/\*\*/g, '').split(/\s+/).filter(w => w.length > 0).length;

  // 1. 行数检查（800-1000 词按一句一行至少 30+ 行，15 行是底线）
  if (lines.length < 15) {
    return { valid: false, reason: `仅 ${lines.length} 行，未按一句一行输出` };
  }

  // 2. 句中标点检查（单行内不应出现多个句子）
  const multiSentenceLines = lines.filter(l => {
    const clean = l.replace(/\*\*/g, '');
    // 去掉行尾句号，检查中间是否还有 .!? 后跟空格和大写
    return /[.!?]\s+[A-Z]/.test(clean);
  });
  if (multiSentenceLines.length > lines.length * 0.15) {
    return { valid: false, reason: `${multiSentenceLines.length} 行包含多个句子，未按一句一行输出` };
  }

  // 3. 词数检查
  if (wordCount < 600) {
    return { valid: false, reason: `仅 ${wordCount} 词，远低于要求的 800-1000 词` };
  }

  // 4. 生词覆盖检查
  const cleanBody = body.replace(/\*\*/g, '').toLowerCase();
  const missing = words.filter(w =>
    !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(cleanBody)
  );
  if (missing.length > words.length * 0.1) {
    return { valid: false, reason: `遗漏 ${missing.length} 个生词：${missing.slice(0, 5).join(', ')}` };
  }

  return { valid: true };
}

// ========== 响应解析 ==========

function parseStoryResponse(text) {
  let title = '';
  let body = '';

  // 尝试匹配 TITLE: ... 格式
  const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
    // 移除标题后的内容
    const afterTitle = text.slice(titleMatch.index + titleMatch[0].length);
    const articleMatch = afterTitle.match(/ARTICLE:\s*\n?([\s\S]*)/i);
    if (articleMatch) {
      body = articleMatch[1].trim();
    } else {
      body = afterTitle.trim();
    }
  } else {
    // 没有 TITLE 标记，尝试取第一行作为标题
    const lines = text.split('\n');
    title = lines[0].replace(/^#+\s*/, '').trim();
    body = lines.slice(1).join('\n').trim();
  }

  // 清理尾部可能残留的自检文本 / markdown 标记 / 格式说明
  body = body
    .replace(/---\s*BEFORE\s+YOU\s+OUTPUT[\s\S]*$/i, '')
    .replace(/---\s*FORMAT\s+RULES[\s\S]*$/i, '')
    .replace(/```[\s\S]*$/, '')
    .trim();

  return { title, body };
}

function parseTranslationResponse(text) {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) return arr;
  } catch {}

  // fallback: 按行解析
  const lines = cleaned
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
  return lines;
}

// ========== 启动 ==========

app.listen(PORT, () => {
  console.log(`📚 EngStory 服务已启动 → http://localhost:${PORT}`);
  if (!DEEPSEEK_KEY || DEEPSEEK_KEY === 'sk-your-key-here') {
    console.warn('⚠️  请在 .env 中配置 DEEPSEEK_API_KEY');
  }
  if (!KIMI_KEY || KIMI_KEY === 'sk-your-key-here') {
    console.warn('⚠️  请在 .env 中配置 KIMI_API_KEY（图片 OCR 需要）');
  }
});
