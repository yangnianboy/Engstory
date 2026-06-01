// ===== 后端 API 调用 =====

const BASE = '';

async function request(url, body) {
  const resp = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || `请求失败 (${resp.status})`);
  }

  return data;
}

/** 调用后端生成故事 */
export async function generateStory(words) {
  return request('/api/generate-story', { words });
}

/** 调用后端翻译全文（传入全文 + 句数，保证上下文连贯） */
export async function translateStory(storyBody, sentenceCount) {
  const data = await request('/api/translate', { storyBody, sentenceCount });
  return data.translations;
}

/** 调用后端 OCR 识别图片中的单词 */
export async function ocrImage(base64Image) {
  const data = await request('/api/ocr', { image: base64Image });
  return data.words;
}
