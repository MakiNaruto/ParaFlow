// ===== Content Script for bbdc-dev =====
// Handles: selection lookup, mini mode, delayed trigger for manual selection

(function () {
  'use strict';

  // --- Constants ---
  const LS_KEYS = {
    GET_WORD: 'langeasyIsGetWord',
    MODIFIER_ENABLED: 'langeasyIsModifierEnabled',
    MODIFIER_KEY: 'langeasyModifierKey',
    MINI_MODE: 'langeasyIsMiniMode'
  };

  // --- State ---
  let isGetWordEnabled = true;
  let isModifierEnabled = true;
  let isMiniMode = false;
  let modKey = 'ctrl';
  let options = {};
  let wrapperOpen = false;
  let currentWrapper = null;
  let wrapperStack = [];
  let lastWord = '';
  let lastLookupTime = 0;
  let lookupCounter = 0;
  let selectionTimer = null;
  let pendingSelection = null;

  // --- CSS Injection ---
  const style = document.createElement('style');
  style.textContent = `
    .langeasy-mini-icon {
      position: fixed; z-index: 999999;
      background: #fffefa; border: 1px solid #e6e2da; border-radius: 10px;
      width: 30px; height: 30px;
      box-shadow: 0 4px 14px rgba(48,46,43,0.14);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; animation: langeasyFadeIn 0.2s forwards;
    }
    .langeasy-mini-icon img { width: 24px; height: 24px; }
    @keyframes langeasyFadeIn { to { opacity: 1; } }
    @media (prefers-color-scheme: dark) {
      .langeasy-mini-icon { background: #333; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
      .langeasy-mini-icon img { filter: brightness(1.2); }
    }
    @media (prefers-reduced-motion: reduce) {
      .langeasy-mini-icon { animation: none; opacity: 1; }
    }
    /* Underline style for recorded words */
    .bbdc-underline-word {
      text-decoration: underline wavy #a34f36;
      text-underline-offset: 2px;
      cursor: pointer;
      position: relative;
      color: inherit;
    }
    .bbdc-underline-word:hover {
      background-color: rgba(163, 79, 54, 0.08);
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);

  // --- Utility Functions ---
  function getOption(key) {
    return options[key] ? options[key][1] : false;
  }

  function isModifierDown(e) {
    if (modKey === 'none') return true;
    if (modKey === 'ctrl') return e.ctrlKey;
    if (modKey === 'alt') return e.altKey;
    if (modKey === 'shift') return e.shiftKey;
    if (modKey === 'meta') return e.metaKey;
    return e.ctrlKey;
  }

  function hasChinese(text) {
    return /[一-龥]/.test(text);
  }

  function hasKorean(text) {
    return /[가-힯]/.test(text) || /[㄰-㆏]/.test(text);
  }

  function isMostlyChinese(text) {
    const chineseChars = [...text].filter(c => hasChinese(c)).length;
    return chineseChars > 5;
  }

  function isMostlyKorean(text) {
    const koreanChars = [...text].filter(c => hasKorean(c)).length;
    return koreanChars > 5;
  }

  function isEnglishOrMixed(text) {
    return /[a-zA-Z']+/.test(text);
  }

  function escapeStr(s) {
    return s ? s.replace(/"/g, '\\"').replace(/'/g, "\\'") : '';
  }

  // --- Sentence Extraction (multi-node aware) ---
  function getTextOffset(root, targetNode, targetOffset) {
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === targetNode) return offset + targetOffset;
      offset += (node.textContent || '').length;
    }
    return offset;
  }

  function extractSentence(selection) {
    if (!selection || !selection.rangeCount) return '';
    const range = selection.getRangeAt(0);

    // Walk up to nearest block-level ancestor
    let container = range.commonAncestorContainer;
    while (container && container.nodeType === Node.TEXT_NODE) {
      container = container.parentNode;
    }
    while (container && container !== document.body) {
      const display = window.getComputedStyle(container).display;
      if (['block', 'list-item', 'table-cell', 'table'].includes(display) ||
          /^(P|DIV|LI|H[1-6]|TD|TH|BLOCKQUOTE|SECTION|ARTICLE)$/.test(container.tagName)) {
        break;
      }
      container = container.parentNode;
    }

    const fullText = container.textContent || '';

    // Use range.toString() to get selected text regardless of container node type
    // (handles both text-node and element-node ranges, e.g. selectNodeContents on a span)
    const selectedText = range.toString();
    if (!selectedText) return '';

    let startOffset = fullText.indexOf(selectedText);
    if (startOffset === -1 && range.startContainer.nodeType === Node.TEXT_NODE) {
      // Fallback: use TreeWalker offset for text-node containers
      startOffset = getTextOffset(container, range.startContainer, range.startOffset);
    } else if (startOffset === -1) {
      return '';
    }
    let endOffset = startOffset + selectedText.length;

    // Expand to sentence boundaries
    let sentenceStart = startOffset;
    while (sentenceStart > 0) {
      const ch = fullText[sentenceStart - 1];
      if (/[.!?\n\r]/.test(ch)) break;
      sentenceStart--;
    }

    let sentenceEnd = endOffset;
    while (sentenceEnd < fullText.length) {
      const ch = fullText[sentenceEnd];
      if (/[.!?\n\r]/.test(ch)) {
        sentenceEnd++;
        break;
      }
      sentenceEnd++;
    }

    let sentence = fullText.slice(sentenceStart, sentenceEnd).trim();
    sentence = sentence.replace(/\s+/g, ' ');
    return sentence;
  }

  // --- Underline Restoration ---
  let underlineApplied = false;
  let underlineVersion = 0;

  function updateUnderlines(sentences) {
    document.querySelectorAll('.bbdc-underline-word').forEach(function (el) {
      el.replaceWith(...el.childNodes);
    });
    document.body.normalize();
    sentences.filter(s => s.url === window.location.href).forEach(s => {
      highlightWordInSentence(s.word, s.text);
    });
  }

  function restoreUnderlines() {
    if (underlineApplied) return; // Already applied
    underlineApplied = true; // Set immediately to prevent duplicate calls
    const currentUrl = window.location.href;
    const version = ++underlineVersion;

    try {
      chrome.runtime.sendMessage({
        source: 'langeasyLookup',
        method: 'getSentencesByUrl',
        url: currentUrl
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('restoreUnderlines: sendMessage error', chrome.runtime.lastError);
          return;
        }
        if (version === underlineVersion && response && response.method === 'getSentencesByUrlResult') {
          updateUnderlines(response.sentences || []);
        }
      });
    } catch (e) {
      // Extension context invalidated or other fatal runtime error
      console.warn('restoreUnderlines: runtime error', e);
    }
  }

  function highlightWordInSentence(word, sentenceText) {
    if (!sentenceText || !word) return;
    // Match across inline elements and whitespace, retaining offsets into text nodes.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('script, style, iframe, textarea, input, [contenteditable], #yddWrapper, #langeasyMiniIcon')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let text = '';
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sentencePattern = sentenceText.trim().split(/\s+/).map(escapeRegex).join('\\s+');
    const sentenceMatch = new RegExp(sentencePattern).exec(text);
    if (!sentenceMatch) return;
    const wordMatch = new RegExp('\\b' + escapeRegex(word) + '\\b', 'i').exec(sentenceMatch[0]);
    if (!wordMatch) return;
    const start = sentenceMatch.index + wordMatch.index;
    const end = start + wordMatch[0].length;
    const first = nodes.find(entry => entry.start <= start && entry.start + entry.node.length > start);
    const last = nodes.find(entry => entry.start < end && entry.start + entry.node.length >= end);
    if (!first || !last || first.node.parentElement.closest('.bbdc-underline-word')) return;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    const span = document.createElement('span');
    span.className = 'bbdc-underline-word';
    span.dataset.word = word;
    span.dataset.url = window.location.href;
    span.dataset.sentence = sentenceText;
    try {
      range.surroundContents(span);
    } catch (e) {
      // Leave page markup intact if the word crosses incompatible elements.
    }
  }

  // --- Underline Click Handler ---
  function handleUnderlineClick(e) {
    const target = e.target.closest('.bbdc-underline-word');
    if (!target) return;

    const url = target.dataset.url;
    if (url && url !== window.location.href) {
      window.open(url, '_blank');
    }
  }

  // --- Underline Hover Handler ---
  function handleUnderlineHover(e) {
    const target = e.target.closest('.bbdc-underline-word');
    if (!target) return;

    const word = target.dataset.word;
    const sentence = target.dataset.sentence || '';
    if (word) {
      // Trigger lookup on hover (debounced)
      clearTimeout(target._hoverTimer);
      target._hoverTimer = setTimeout(() => {
        if (!wrapperOpen) {
          // Use the selection-based approach to trigger lookup
          const sel = window.getSelection();
          sel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(target);
          sel.addRange(range);

          doQuery(word, e.pageX, e.pageY, e.screenX, e.screenY);
        }
      }, 500);
    }
  }

  function handleUnderlineHoverOut(e) {
    const target = e.target.closest('.bbdc-underline-word');
    if (!target) return;
    clearTimeout(target._hoverTimer);
  }

  // --- Wrapper Management ---
  function closeWrapper() {
    if (!wrapperOpen && !currentWrapper) return false;

    wrapperOpen = false;
    if (currentWrapper) {
      while (wrapperStack.length) {
        const w = wrapperStack.pop();
        if (w.parentNode) w.parentNode.removeChild(w);
      }
      currentWrapper = null;
    }
    return true;
  }

  function createWrapper(word, sentence, pageX, pageY, screenX, screenY) {
    try {
      closeWrapper();

      const winW = window.innerWidth;
      const winH = window.innerHeight;
      let iframeUrl;
      try {
        iframeUrl = chrome.runtime.getURL('lookup.html');
      } catch (e) {
        console.log('Extension context invalid, cannot create lookup');
        return null;
      }

      const wrapper = document.createElement('div');
      const iframe = document.createElement('iframe');

      iframe.setAttribute('src', iframeUrl);
      iframe.id = 'langeasyLexisIframe';
      // iframe 为跨源（扩展页嵌入网页），Chrome 默认禁止跨源 iframe 自动播放，
      // 需显式委托 autoplay 权限，否则查词发音无法播放（popup 顶层页不受此限制）。
      iframe.setAttribute('allow', 'autoplay');
      iframe.style.border = 'none';
      const initialWidth = Math.max(1, Math.min(300, winW - 20));
      iframe.style.width = initialWidth + 'px';
      iframe.style.display = 'block';

      wrapper.id = 'yddWrapper';
      wrapper.style.position = 'fixed';
      wrapper.style.zIndex = '99999';
      wrapper.style.width = initialWidth + 'px';
      wrapper.style.minWidth = '0';
      wrapper.style.maxWidth = 'none';

      // Use viewport-relative coordinates for fixed positioning.
      // pageX/Y are document coordinates; convert to viewport coordinates
      // so the popup stays near the selection regardless of page scroll
      // or complex containing-block layouts (e.g. OpenAI docs).
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const clientX = pageX - scrollX;
      const clientY = pageY - scrollY;

      const wrapperWidth = initialWidth;
      const estimatedHeight = 150;
      const margin = 10;

      // Horizontal: prefer right of cursor, fallback left
      let left;
      if (clientX + wrapperWidth + margin <= winW) {
        left = clientX + margin;
      } else {
        left = clientX - wrapperWidth - margin;
      }
      left = Math.max(margin, Math.min(left, winW - wrapperWidth - margin));

      // Vertical: prefer below cursor, fallback above
      let top;
      if (clientY + estimatedHeight + margin * 2 <= winH) {
        top = clientY + margin;
      } else {
        top = clientY - estimatedHeight - margin;
      }
      top = Math.max(margin, Math.min(top, winH - estimatedHeight - margin));

      wrapper.style.left = left + 'px';
      wrapper.style.top = top + 'px';

      wrapper.onmouseover = () => { wrapperOpen = true; };
      wrapper.onmouseout = () => { wrapperOpen = false; };

      wrapper.appendChild(iframe);
      document.documentElement.appendChild(wrapper);
      wrapperStack.push(wrapper);
      currentWrapper = wrapper;

      // Send data to iframe once loaded
      iframe.onload = function () {
        iframe.contentWindow.postMessage({
          word: word,
          sentence: sentence || '',
          url: window.location.href,
          info: lastWord,
          methodName: 'innerHTML'
        }, '*');
      };

      // Also handle if already loaded
      if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        iframe.contentWindow.postMessage({
          word: word,
          sentence: sentence || '',
          url: window.location.href,
          info: lastWord,
          methodName: 'innerHTML'
        }, '*');
      }

      lookupCounter++;
      return wrapper;
    } catch (e) {
      console.log('Error creating wrapper', e);
      return null;
    }
  }

  // --- Lookup Trigger ---
  function triggerLookup(word, sentence, pageX, pageY, screenX, screenY) {
    closeWrapper();
    createWrapper(word, sentence || '', pageX || 0, pageY || 0, screenX || 0, screenY || 0);
  }

  // --- Query (pass word directly to iframe, let iframe fetch definition) ---
  // Store mouse position for triggerLookup to use after async fetch
  let lastPageX = 0, lastPageY = 0, lastScreenX = 0, lastScreenY = 0;
  let lastSentence = '';

  async function doQuery(word, pageX, pageY, screenX, screenY) {
    closeWrapper();
    // Save position for triggerLookup
    lastPageX = pageX;
    lastPageY = pageY;
    lastScreenX = screenX;
    lastScreenY = screenY;
    word = escapeStr(word);

    // Extract sentence from current selection
    const selection = window.getSelection();
    const sentence = selection && selection.rangeCount ? extractSentence(selection) : '';
    lastSentence = sentence;

    // Pass word directly to iframe (the iframe will fetch definition itself)
    triggerLookup(word, sentence, pageX, pageY, screenX, screenY);
  }

  // --- Mini Mode Icon ---
  function removeMiniIcon() {
    const icon = document.getElementById('langeasyMiniIcon');
    if (icon) {
      icon.style.display = 'none';
      setTimeout(() => {
        if (icon.parentNode) icon.parentNode.removeChild(icon);
      }, 0);
    }
  }

  function showMiniIcon(word, pageX, pageY) {
    removeMiniIcon();

    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const winW = window.innerWidth;
    let left = rect.right + 5;
    let top = rect.top - 30;

    if (left + 24 > winW) left = winW - 30;
    if (top < 5) top = 5;

    const icon = document.createElement('div');
    icon.id = 'langeasyMiniIcon';
    icon.className = 'langeasy-mini-icon';
    icon.innerHTML = `<img src="${chrome.runtime.getURL('images/icon_128.png')}" alt="翻译">`;
    icon.style.left = left + 'px';
    icon.style.top = top + 'px';

    icon.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      icon.style.display = 'none';
      doQuery(word, pageX, pageY, 0, 0);
      setTimeout(() => removeMiniIcon(), 0);
    });

    document.documentElement.appendChild(icon);
  }

  // --- Settings Cache ---
  let settingsLoaded = false;

  async function loadSettings(force) {
    if (settingsLoaded && !force) return;
    try {
      const data = await chrome.storage.local.get([
        LS_KEYS.GET_WORD,
        LS_KEYS.MODIFIER_ENABLED,
        LS_KEYS.MINI_MODE,
        LS_KEYS.MODIFIER_KEY
      ]);
      if (typeof data[LS_KEYS.GET_WORD] === 'boolean') isGetWordEnabled = data[LS_KEYS.GET_WORD];
      if (typeof data[LS_KEYS.MODIFIER_ENABLED] === 'boolean') isModifierEnabled = data[LS_KEYS.MODIFIER_ENABLED];
      if (typeof data[LS_KEYS.MINI_MODE] === 'boolean') {
        isMiniMode = data[LS_KEYS.MINI_MODE];
        options.mini_mode = ['checked', isMiniMode];
      }
      if (data[LS_KEYS.MODIFIER_KEY]) modKey = data[LS_KEYS.MODIFIER_KEY];
      settingsLoaded = true;
    } catch (e) {
      console.log('Error loading settings', e);
    }
  }

  // Listen for settings changes from other contexts (popup/options)
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    // Storage key matches STORAGE_KEYS.SENTENCES in shared/constants.js.
    if (changes.bbdc_sentences) {
      ++underlineVersion;
      underlineApplied = true;
      updateUnderlines(changes.bbdc_sentences.newValue || []);
    }
    const relevantKeys = [LS_KEYS.GET_WORD, LS_KEYS.MODIFIER_ENABLED, LS_KEYS.MINI_MODE, LS_KEYS.MODIFIER_KEY];
    const needsRefresh = relevantKeys.some(function (k) { return changes[k]; });
    if (needsRefresh) {
      settingsLoaded = false; // Force reload on next interaction
    }
  });

  // --- Event Listeners ---

  // Click handler - close wrapper on outside click
  // IMPORTANT: double-click selection triggers mouseup → click in sequence.
  // Without a guard, click hides the wrapper immediately after mouseup created it,
  // making the iframe invisible to the user. Skip hiding if the click follows
  // a lookup within the debounce window (500ms).
  // NOTE: Do NOT cancel selectionTimer here — click always fires after mouseup
  // (for both double-click and drag selection), so it would prevent the delayed
  // lookup from ever executing.
  document.addEventListener('click', function (e) {
    const wrapper = document.getElementById('yddWrapper');
    if (wrapper) {
      if (Date.now() - lastLookupTime < 500) return;
      wrapper.style.display = 'none';
    }
    if (e.target.id === 'langeasyMiniIcon' || e.target.closest('#langeasyMiniIcon')) return;
    removeMiniIcon();
  }, false);

  // Main mouseup handler for selection lookup
  document.body.addEventListener('mouseup', async function (e) {
    await loadSettings();

    // Close wrapper if user clicks elsewhere
    if (!wrapperOpen) {
      if (currentWrapper) {
        const now = Date.now();
        if (now - lastLookupTime < 500) return;
        while (wrapperStack.length) {
          const w = wrapperStack.pop();
          if (w.parentNode) w.parentNode.removeChild(w);
        }
        currentWrapper = null;
      }
    }

    // === NEW LOGIC: 划词翻译 和 启用触发键 各自独立控制 ===
    // 划词翻译 isGetWordEnabled: independently enables selection lookup
    // 启用触发键 isModifierEnabled + modKey: independently enables modifier+selection lookup
    // Either condition being true is sufficient to trigger lookup
    const shouldLookup = isGetWordEnabled || (isModifierEnabled && isModifierDown(e));
    if (!shouldLookup) return;

    let selection = String(window.getSelection()).trim();
    // Must be a single word (no whitespace), reject multi-word selections and overlong text
    if (/\s/.test(selection) || selection.length > 50) return;
    if (!selection) return;

    const englishOnly = getOption('english_only');
    if (englishOnly && isMostlyChinese(selection)) return;
    if (englishOnly && isMostlyKorean(selection)) return;

    // Extract English word
    let word = selection;
    if (englishOnly) {
      const match = /[a-zA-Z ]+/.exec(word);
      word = match ? match[0] : '';
    }

    if (!word || !isEnglishOrMixed(word)) return;

    // Cancel any previous pending delayed lookup
    if (selectionTimer) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }

    // Store pending selection data for delayed execution
    pendingSelection = {
      word: word,
      pageX: e.pageX,
      pageY: e.pageY,
      screenX: e.screenX,
      screenY: e.screenY,
      miniMode: isMiniMode
    };

    // Use a slight delay (300ms) before triggering lookup.
    // This prevents accidental triggers from rapid clicks/scrolling
    // while keeping the interaction feeling responsive.
    // Industry-standard delay used by Saladict, Bob, DeepL, etc.
    selectionTimer = setTimeout(() => {
      if (!pendingSelection) return;

      const { word, pageX, pageY, screenX, screenY, miniMode } = pendingSelection;
      pendingSelection = null;
      selectionTimer = null;

      // Guard: verify selection still contains the word (user may have clicked away)
      const currentSel = String(window.getSelection()).trim();
      if (!currentSel || !currentSel.toLowerCase().includes(word.toLowerCase())) return;

      closeWrapper();
      lastLookupTime = Date.now();
      lastWord = word;

      if (miniMode) {
        showMiniIcon(word, pageX, pageY);
      } else {
        doQuery(word, pageX, pageY, screenX, screenY);
      }
    }, 300);
  }, false);

  // Listen for messages from lookup iframe
  window.addEventListener('message', function (e) {
    const { methodName, height, width } = e.data;
    if (methodName === 'langeasyLexisSetHeight') {
      const iframe = document.querySelector('#langeasyLexisIframe');
      if (iframe && e.source === iframe.contentWindow && Number.isFinite(height) && height > 0) {
        // Expand freely until the viewport is full, then scroll the iframe as a whole.
        const margin = 8;
        const availableHeight = Math.max(1, window.innerHeight - margin * 2);
        const visibleHeight = Math.min(height, availableHeight);
        iframe.style.height = visibleHeight + 'px';
        const wrapper = iframe.parentElement;
        if (Number.isFinite(width) && width > 0) {
          const visibleWidth = Math.max(1, Math.min(width, window.innerWidth - margin * 2));
          iframe.style.width = visibleWidth + 'px';
          wrapper.style.width = visibleWidth + 'px';
          const left = wrapper.getBoundingClientRect().left;
          wrapper.style.left = Math.max(margin, Math.min(left, window.innerWidth - visibleWidth - margin)) + 'px';
        }
        const top = wrapper.getBoundingClientRect().top;
        wrapper.style.top = Math.max(margin, Math.min(top, window.innerHeight - visibleHeight - margin)) + 'px';
      }
    }
  }, false);

  // Underline click handler
  document.addEventListener('click', handleUnderlineClick, false);

  // Underline hover handlers
  document.addEventListener('mouseover', handleUnderlineHover, false);
  document.addEventListener('mouseout', handleUnderlineHoverOut, false);

  // --- Initialize: Restore underlines on page load ---
  document.addEventListener('DOMContentLoaded', function () {
    restoreUnderlines();
  });

  // Also run restore if DOM is already loaded
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    restoreUnderlines();
  }

  // MutationObserver for dynamically loaded content
  const observer = new MutationObserver(function (mutations) {
    if (!underlineApplied) {
      restoreUnderlines();
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

})();
