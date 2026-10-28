// ===== Lookup Iframe Script =====
// Displays word definition and manages word/sentence local storage

(function () {
  'use strict';

  let currentWord = '';
  let currentSentence = '';
  let currentUrl = '';
  let currentInfo = '';
  let wordExists = false;
  let isLoggedIn = false;
  let hasDictionaryEntry = false;
  let definitionRequestId = 0;

  // --- Build the lookup UI ---
  function buildUI(word, sentence, url, info) {
    const container = document.getElementById('yddWrapper');
    if (!container) return;

    // Start MutationObserver now that DOM is guaranteed ready
    startHeightObserver();

    isLoggedIn = false;
    hasDictionaryEntry = false;
    currentWord = word;
    currentSentence = sentence || '';
    currentUrl = url || '';
    currentInfo = info || '';

    const html = `
      <div id="langeasyContainer">
        <!-- Word Header -->
        <div id="langeasyTitle">
          <span class="icon_logo" aria-hidden="true"></span>
          <span>段译随行</span>
        </div>

        <!-- Word Definition Area -->
        <div id="langeasyDefinition">
          <div id="langeasyTip" style="display:none;">发音不存在</div>

          <!-- Word and Action Buttons -->
          <div id="wordActionRow">
            <span id="langeasyWord">${word}</span>
            <span id="actionButtons">
              <button id="wordBtn" style="display:none;" class="action-btn" title="添加/删除单词" aria-label="收藏或移除单词"></button>
              <button id="sentenceBtn" class="action-btn" title="收藏当前单词所在的例句" aria-label="收藏当前单词所在的例句"></button>
            </span>
          </div>

          <!-- Pronunciation -->
          <table id="pronTable">
            <tbody>
              <tr>
                <td width="40">英音：</td>
                <td>
                  <span id="uk_pron"></span>
                  <span type="UK" class="langeasy_icon_audio" alt=""></span>
                </td>
              </tr>
              <tr>
                <td>美音：</td>
                <td>
                  <span id="us_pron"></span>
                  <span type="US" class="langeasy_icon_audio" alt=""></span>
                </td>
              </tr>
              <tr>
                <td>词义：</td>
                <td>
                  <div id="interpret"></div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Stored Sentences Section (shown when this word has stored sentences) -->
          <div id="storedSentencesSection" style="display:none;">
            <hr class="section-divider">
            <div id="storedSentencesList"></div>
          </div>
        </div>

        <audio id="langeasyAudio"></audio>
      </div>
    `;

    container.innerHTML = html;

    // Send height to parent
    updateHeight();

    // Check login status and word status
    checkLoginStatus();
    checkWordStatus(word);

    // Check sentence context
    if (sentence) {
      checkSentenceContext(word, sentence, url);
    } else {
      updateSentenceBtn('add');
    }

    // Audio click handler
    setupAudioHandler();

    // Word button click handler
    document.getElementById('wordBtn').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoggedIn) return;
      if (wordExists) {
        removeWord(word);
      } else {
        addWord(word);
      }
    }, false);

    // Sentence button click handler
    document.getElementById('sentenceBtn').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (this.dataset.mode === 'delete') {
        removeSentenceByContext(word, currentSentence, currentUrl);
      } else {
        addSentence(word, currentSentence, currentUrl);
      }
    }, false);
  }

  // --- Check Login Status ---
  // 本 iframe 嵌入在网页中属第三方上下文，直接 fetch bbdc.cn 不会带登录 Cookie，
  // 故经 background（扩展顶层上下文）代为请求（与其它 bbdc:* 消息一致）。
  function checkLoginStatus() {
    chrome.runtime.sendMessage({ type: 'bbdc:check-login' }, function (response) {
      isLoggedIn = !!(response && response.ok && response.data && response.data.result_code === 200);
      updateWordBtn(wordExists);
    });
  }

  // --- Check Word Status ---
  function checkWordStatus(word) {
    chrome.runtime.sendMessage({
      source: 'langeasyLookup',
      method: 'checkNewWord',
      word: word
    }, function (response) {
      if (response && response.method === 'checkNewWordResult') {
        wordExists = response.data.exists;
        updateWordBtn(wordExists);

        // Fetch and display stored sentences regardless of whether the word is in the wordbook
        loadStoredSentences(word);
      }
    });
  }

  // --- Check Sentence Context ---
  function checkSentenceContext(word, sentence, url) {
    if (!sentence) {
      updateSentenceBtn('add');
      return;
    }
    chrome.runtime.sendMessage({
      source: 'langeasyLookup',
      method: 'checkSentenceContext',
      word: word,
      sentence: sentence,
      url: url
    }, function (response) {
      if (response && response.method === 'checkSentenceContextResult') {
        updateSentenceBtn(response.exists ? 'delete' : 'add');
      }
    });
  }

  // --- Load Stored Sentences ---
  function loadStoredSentences(word) {
    chrome.runtime.sendMessage({
      source: 'langeasyLookup',
      method: 'getWordSentences',
      word: word
    }, function (response) {
      if (response && response.method === 'getWordSentencesResult') {
        const sentences = response.sentences || [];
        if (sentences.length > 0) {
          displayStoredSentences(sentences);
        } else {
          // No sentences left — hide the stored sentences section
          const section = document.getElementById('storedSentencesSection');
          const list = document.getElementById('storedSentencesList');
          if (section) section.style.display = 'none';
          if (list) list.innerHTML = '';
          updateHeight();
        }
      }
    });
  }

  // --- Display Stored Sentences ---
  function displayStoredSentences(sentences) {
    const section = document.getElementById('storedSentencesSection');
    const list = document.getElementById('storedSentencesList');
    if (!section || !list) return;

    let html = '<div class="sentences-header">📝 已收录例句</div>';
    sentences.forEach(function (s) {
      const displayUrl = s.url ? s.url.replace(/^https?:\/\//, '').substring(0, 40) + (s.url.length > 40 ? '...' : '') : '';
      html += `
        <div class="sentence-item">
          <div class="sentence-text">"${escapeHtml(s.text)}"</div>
          <div class="sentence-url">
            <a href="${escapeHtml(s.url)}" target="_blank" title="${escapeHtml(s.url)}">→ ${escapeHtml(displayUrl)}</a>
          </div>
        </div>
      `;
    });

    list.innerHTML = html;
    section.style.display = 'block';

    // Update height
    updateHeight();
  }

  function bookmarkLabel(added, label) {
    return '<svg viewBox="0 0 24 24" fill="' + (added ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/></svg><span>' + label + '</span>';
  }

  // --- Update Word Button ---
  function updateWordBtn(exists) {
    const btn = document.getElementById('wordBtn');
    if (!btn) return;
    btn.style.display = isLoggedIn && hasDictionaryEntry ? '' : 'none';
    if (!isLoggedIn) {
      btn.innerHTML = bookmarkLabel(false, '添加单词');
      btn.className = 'action-btn action-disabled';
      btn.title = '请登录 bbdc.cn 后添加单词';
      return;
    }
    if (exists) {
      btn.innerHTML = bookmarkLabel(true, '单词已添加');
      btn.className = 'action-btn action-delete';
      btn.title = '从不背单词生词本移除当前单词';
    } else {
      btn.innerHTML = bookmarkLabel(false, '添加单词');
      btn.className = 'action-btn action-add';
      btn.title = '收藏当前单词到不背单词生词本';
    }
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(exists));
  }

  // --- Update Sentence Button ---
  function updateSentenceBtn(mode) {
    const btn = document.getElementById('sentenceBtn');
    if (!btn) return;
    btn.style.display = currentSentence ? '' : 'none';
    if (mode === 'delete') {
      btn.innerHTML = bookmarkLabel(true, '例句已添加');
      btn.className = 'action-btn action-delete';
      btn.title = '删除此例句';
      btn.dataset.mode = 'delete';
    } else {
      if (currentSentence) {
        btn.innerHTML = bookmarkLabel(false, '添加例句');
        btn.className = 'action-btn action-add';
        btn.title = '收藏当前单词所在的例句';
        btn.dataset.mode = 'add';
      } else {
        btn.style.display = 'none';
      }
    }
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(mode === 'delete'));
  }

  // --- Add Word ---
  function addWord(word) {
    if (!isLoggedIn || !hasDictionaryEntry) return;
    chrome.runtime.sendMessage({
      source: 'langeasyLookup',
      method: 'addNewWord',
      word: word,
      info: currentInfo || ''
    }, function (response) {
      if (response && response.method === 'addNewWordResult') {
        if (response.error) {
          if (response.loginRequired) isLoggedIn = false;
          updateWordBtn(wordExists);
          return;
        }
        wordExists = true;
        updateWordBtn(true);
        // Reload stored sentences
        loadStoredSentences(word);
        // Update sentence button
        if (currentSentence) {
          checkSentenceContext(word, currentSentence, currentUrl);
        }
      }
    });
  }

  // --- Remove Word ---
  function removeWord(word) {
    chrome.runtime.sendMessage({
      source: 'langeasyLookup',
      method: 'removeWord',
      word: word,
      info: currentInfo || ''
    }, function (response) {
      if (response && response.method === 'removeWordResult') {
        wordExists = false;
        updateWordBtn(false);
        // Reload stored sentences (they are kept independent of the word)
        loadStoredSentences(word);
        if (currentSentence) {
          checkSentenceContext(word, currentSentence, currentUrl);
        }
      }
    });
  }

  // --- Add Sentence ---
  function addSentence(word, sentence, url) {
    if (!sentence) return;

    chrome.runtime.sendMessage({
      source: 'langeasyLookup',
      method: 'addSentence',
      word: word,
      sentence: sentence,
      url: url
    }, function (response) {
      if (response && response.method === 'addSentenceResult') {
        // Reload stored sentences (sentence is independent of whether the word is in the wordbook)
        loadStoredSentences(word);
        updateSentenceBtn('delete');
      }
    });
  }

  // --- Remove Sentence by Context ---
  function removeSentenceByContext(word, sentence, url) {
    if (!sentence) return;

    chrome.runtime.sendMessage({
      source: 'langeasyLookup',
      method: 'removeSentenceByContext',
      word: word,
      sentence: sentence,
      url: url
    }, function (response) {
      if (response && response.method === 'removeSentenceByContextResult') {
        // Reload stored sentences (sentence is independent of whether the word is in the wordbook)
        loadStoredSentences(word);
        updateSentenceBtn('add');
      }
    });
  }

  // --- Audio Handler ---
  function setupAudioHandler() {
    const audioHandler = function (e) {
      const target = e.target;
      if (target.className === 'langeasy_icon_audio') {
        const audio = document.getElementById('langeasyAudio');
        const type = target.getAttribute('type');
        // 优先用释义接口返回的标准词形（与 popup 一致），未返回前回退到展示的单词
        const wordEl = document.getElementById('langeasyWord');
        const word = target.getAttribute('alt') || (wordEl ? wordEl.textContent : '') || '';
        audio.src = 'https://audio2.beingfine.cn/speeches/' + type + '/' + type + '-speech/' + word + '.mp3';
        // 不再用 autoplay 属性：复用的 audio 元素首次播放后 autoplaying 标志被清除，
        // 且跨源 iframe 中 autoplay 属性本身就被 Chrome 策略拦截；改为用户点击时直接 play()。
        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(function () {
            // 播放被拒绝（网络失败会触发 onerror，这里只兜底避免未处理的 rejection）
          });
        }
        audio.onerror = function () {
          const tip = document.getElementById('langeasyTip');
          clearTimeout(tip.timer);
          tip.innerHTML = '发音不存在';
          tip.style.display = 'block';
          function startTimer() {
            clearTimeout(tip.timer);
            tip.timer = setTimeout(function () {
              tip.innerHTML = '';
              tip.style.display = 'none';
            }, 3000);
          }
          startTimer();
          if (!tip._mouseHandlersAttached) {
            tip.addEventListener('mouseenter', function () { clearTimeout(tip.timer); });
            tip.addEventListener('mouseleave', startTimer);
            tip._mouseHandlersAttached = true;
          }
        };
      }
    };
    document.addEventListener('click', audioHandler, false);
  }

  // --- Utility: Update iframe height to match content ---
  function updateHeight() {
    // Use the container's offsetHeight instead of documentElement.scrollHeight.
    // The CSS sets body,html{height:100%} which means scrollHeight never
    // shrinks below the viewport height when content gets shorter (e.g. after
    // deleting the last sentence). offsetHeight gives the actual rendered
    // height of the content container regardless of CSS height rules.
    var container = document.getElementById('langeasyContainer');
    if (!container) return;
    var height = container.offsetHeight;
    if (height > 0) {
      const word = document.getElementById('langeasyWord');
      const buttons = document.getElementById('actionButtons');
      const definition = document.getElementById('langeasyDefinition');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      let width = 300;
      if (word && buttons && definition && context) {
        context.font = window.getComputedStyle(word).font;
        const spacing = window.getComputedStyle(definition);
        // Allow the full word and both buttons to share a row, plus padding and borders.
        width = Math.max(width, Math.ceil(context.measureText(word.textContent).width +
          buttons.getBoundingClientRect().width + parseFloat(spacing.paddingLeft) +
          parseFloat(spacing.paddingRight) + 16));
      }
      window.parent.postMessage({ methodName: 'langeasyLexisSetHeight', height: height, width: width }, '*');
    }
  }

  window.addEventListener('resize', updateHeight);

  // --- MutationObserver to auto-update height on content changes ---
  // (started on first buildUI call to ensure DOM is ready)
  var heightObserver = null;
  var heightObserverTimer = null;

  function startHeightObserver() {
    if (heightObserver) return;
    heightObserver = new MutationObserver(function () {
      // Debounce: avoid rapid-fire updates during DOM construction
      clearTimeout(heightObserverTimer);
      heightObserverTimer = setTimeout(function () {
        updateHeight();
      }, 50);
    });
    heightObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
  }

  // --- Utility: Escape HTML ---
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Handle Definition Data ---
  async function handleDefinition(data) {
    const requestId = ++definitionRequestId;
    const { word, sentence, url, info } = data;
    buildUI(word, sentence, url, info);
    const isCurrent = () => requestId === definitionRequestId;
    document.getElementById('interpret').textContent = '查询中…';
    let entry = null;
    try {
      const response = await fetch('https://langeasy.com.cn/loadLexisList.action?strict=1&word=' + encodeURIComponent(word));
      if (!response.ok) throw new Error('词典请求失败');
      const result = await response.json();
      entry = result?.wordlist?.find(w => w.word && typeof w.interpret === 'string' && w.interpret.trim());
    } catch (e) {
      console.log('Error fetching definition', e);
    }
    if (!isCurrent()) return;
    if (entry) {
      hasDictionaryEntry = true;
      updateWordBtn(wordExists);
      currentInfo = entry.interpret;
      document.getElementById('uk_pron').textContent = entry.uk_pron || '';
      document.getElementById('us_pron').textContent = entry.us_pron || '';
      const interpretDiv = document.getElementById('interpret');
      interpretDiv.innerHTML = '';
      entry.interpret.split(/\r?\n/).forEach(function (line) {
        const p = document.createElement('p');
        p.className = 'langeasyline';
        p.textContent = line;
        interpretDiv.appendChild(p);
      });
      document.querySelectorAll('.langeasy_icon_audio').forEach(function (el) {
        el.setAttribute('alt', entry.word);
      });
      updateHeight();
      return;
    }

    // Missing dictionary entries can still be translated and saved as sentence contexts.
    document.querySelectorAll('#pronTable tr').forEach(function (row, index) {
      if (index < 2) row.style.display = 'none';
    });
    try {
      // Matches LS_KEYS.LOOKUP_FALLBACK in shared/constants.js (classic iframe script).
      const settings = await chrome.storage.local.get('langeasyLookupFallbackEnabled');
      if (!isCurrent()) return;
      if (settings.langeasyLookupFallbackEnabled === false) {
        document.getElementById('interpret').textContent = '未查到词典释义';
        updateHeight();
        return;
      }
      document.getElementById('interpret').textContent = '词典未查到结果，正在使用所选翻译源…';
      updateHeight();
      const response = await chrome.runtime.sendMessage({ action: 'translate', text: word });
      if (!isCurrent()) return;
      if (!response?.ok || typeof response.translation !== 'string' || !response.translation.trim()) {
        throw new Error(response?.error || '翻译接口未返回结果');
      }
      document.getElementById('interpret').textContent = response.translation;
    } catch (e) {
      if (!isCurrent()) return;
      document.getElementById('interpret').textContent = '翻译失败：' + e.message;
    }
    updateHeight();
  }

  // Keep the open lookup card consistent with changes from the collection page.
  // Storage key matches STORAGE_KEYS.SENTENCES in shared/constants.js.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.bbdc_sentences || !currentWord) return;
    loadStoredSentences(currentWord);
    checkSentenceContext(currentWord, currentSentence, currentUrl);
  });

  // --- Listen for messages from content script ---
  window.addEventListener('message', function (e) {
    const data = e.data;
    if (data.methodName === 'innerHTML' && data.word) {
      handleDefinition(data);
    }
  }, false);

})();
