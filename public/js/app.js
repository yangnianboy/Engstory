// ===== EngStory 主入口 =====

import { subscribe, setState, state } from './state.js';
import {
  initModeTabs,
  initTextInput,
  initImageInput,
  initGenerateButton,
  initErrorBanner,
  initBackButton,
  initCopyButtons,
  initHistoryPanel,
  renderWordChips,
  renderError,
} from './ui.js';

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', () => {
  // 初始化所有 UI 模块
  initModeTabs();
  initTextInput();
  initImageInput();
  initGenerateButton();
  initErrorBanner();
  initBackButton();
  initCopyButtons();
  initHistoryPanel();

  // 订阅状态变化以更新 UI
  subscribe(handleStateChange);

  // 初始渲染
  updateGenerateButtonState();
});

function handleStateChange(newState) {
  // 错误展示
  renderError();

  // 生成按钮状态
  updateGenerateButtonState();
}

function updateGenerateButtonState() {
  const btn = document.querySelector('#generateBtn');
  if (!btn) return;

  const disabled = state.rawWords.length === 0 ||
    state.step === 'generating' ||
    state.step === 'translating' ||
    state.step === 'ocr';

  btn.disabled = disabled;

  if (state.step === 'done') {
    btn.textContent = 'Regenerate';
  } else if (state.step === 'generating' || state.step === 'translating') {
    btn.textContent = 'Generating...';
  } else {
    btn.textContent = 'Generate Story';
  }
}

// ===== 键盘快捷键 =====
document.addEventListener('keydown', (e) => {
  // Ctrl+Enter 触发生成
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    document.querySelector('#generateBtn')?.click();
  }
  // Escape 关闭错误
  if (e.key === 'Escape') {
    setState({ error: null });
  }
});
