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

// 1. 故事生成 → DeepSeek
app.post('/api/generate-story', async (req, res) => {
  try {
    const { words } = req.body;
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: '请提供生词列表' });
    }

    const prompt = buildStoryPrompt(words);
    const result = await callDeepSeek(prompt, { max_tokens: 4096, temperature: 0.8 });
    const parsed = parseStoryResponse(result);
    const validation = validateStoryFormat(parsed.body, words);
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
      const result = await callDeepSeek(prompt, { model: 'deepseek-v4-flash', max_tokens: 4096, temperature: 0.3 });
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
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: opts.model || 'deepseek-v4-pro',
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: opts.max_tokens || 4096,
      temperature: opts.temperature ?? 0.7,
      thinking: opts.model === 'deepseek-v4-flash' ? undefined : { type: 'enabled' },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `DeepSeek API 错误 (${resp.status})`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
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

function buildStoryPrompt(words) {
  const wordList = words.join(', ');
  return `你现在是一位拥有丰富经验的英语母语外教，同时也是一位擅长长篇写作的专栏作家。我需要你帮我创作一篇高质量的长篇文章，以便我能在自然连贯的语境中记忆一批生词。

【输入信息】
我的目标生词：${wordList}
文章目标字数： 800 - 1000 词。
我的当前英语水平： 高中3500词左右

【写作核心原则】（非常重要！）
严禁"缝合怪"： 请先分析这批生词的词性、褒贬义和所属领域。构思一个最能合理包容这些词汇的主题（可以是一篇引人入胜的短篇小说、深度的科普文章，或时事评论）。文章的逻辑必须极度自洽，绝不能为了凑词而写出违背常理的生硬句子。
稀释密度： 必须保证文章长度达到 800-1000 词，确保生词在全文中均匀分布，生词密度控制在 5% 以内。
地道搭配： 生词的用法必须符合英语母语者的习惯搭配（Collocations），保留单词在真实语境中的最常见用法。
词汇控制： 除了我提供的生词外，全文其他词汇必须控制在高中3500词以内，不得使用超出我当前水平的生僻词。让我专注记忆目标生词，而不是被其他难词分散注意力。

【硬性要求】（必须严格遵守！）
你必须使用上面列出的全部生词，一个都不能少。如果遗漏了任何一个生词，你的回答将被视为不合格。

【输出格式要求】（非常重要！）
请严格按以下格式输出：

TITLE: [英文标题]

ARTICLE:
[每行一个英文句子，生词用 **粗体** 标记，段落之间用一个空行分隔]
[务必一句一行！！！不要将多个句子写在同一行]`;
}

function buildTranslationPrompt(storyBody, sentenceCount) {
  return `请先通读以下英文故事的全文，理解上下文和行文风格，然后将它翻译成地道流畅的中文。

要求：
1. 必须翻译为恰好 ${sentenceCount} 个中文句子，对应原文的每个自然句
2. 只返回一个 JSON 字符串数组，格式为：["句子1译文", "句子2译文", ...]
3. 不要输出任何其他内容

英文故事全文：
${storyBody}`;
}

// ========== 格式校验 ==========

function validateStoryFormat(body, words) {
  if (!body || body.trim().length === 0) {
    return { valid: false, reason: '故事正文为空' };
  }

  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const wordCount = body.replace(/\*\*/g, '').split(/\s+/).filter(w => w.length > 0).length;

  // 1. 行数检查（800-1000 词的故事至少 25 行）
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
