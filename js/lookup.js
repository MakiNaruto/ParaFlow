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

  // --- Build the lookup UI ---
  function buildUI(word, sentence, url, info) {
    const container = document.getElementById('yddWrapper');
    if (!container) return;

    // Start MutationObserver now that DOM is guaranteed ready
    startHeightObserver();

    isLoggedIn = false;
    currentWord = word;
    currentSentence = sentence || '';
    currentUrl = url || '';
    currentInfo = info || '';

    const html = `
      <div id="langeasyContainer">
        <!-- Word Header -->
        <div id="langeasyTitle">
          <a href="https://bbdc.cn" class="icon_logo" target="_blank"></a>
          <a href="https://bbdc.cn" target="_blank">段译随行</a>
        </div>

        <!-- Word Definition Area -->
        <div id="langeasyDefinition">
          <div id="langeasyTip" style="display:none;">发音不存在</div>

          <!-- Word and Action Buttons -->
          <div id="wordActionRow">
            <span id="langeasyWord">${word}</span>
            <span id="actionButtons">
              <button id="wordBtn" class="action-btn" title="添加/删除单词" aria-label="收藏或移除单词"></button>
              <button id="sentenceBtn" class="action-btn" title="添加/删除例句" aria-label="收藏或移除例句"></button>
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

  // --- Update Word Button ---
  function updateWordBtn(exists) {
    const btn = document.getElementById('wordBtn');
    if (!btn) return;
    btn.style.display = isLoggedIn ? '' : 'none';
    if (!isLoggedIn) {
      btn.innerHTML = '📕';
      btn.className = 'action-btn action-disabled';
      btn.title = '请登录 bbdc.cn 后添加单词';
      return;
    }
    if (exists) {
      btn.innerHTML = '🗑';
      btn.className = 'action-btn action-delete';
      btn.title = '从单词本删除';
    } else {
      btn.innerHTML = '📕';
      btn.className = 'action-btn action-add';
      btn.title = '添加到单词本';
    }
  }

  // --- Update Sentence Button ---
  function updateSentenceBtn(mode) {
    const btn = document.getElementById('sentenceBtn');
    if (!btn) return;
    if (mode === 'delete') {
      btn.innerHTML = '🗑';
      btn.className = 'action-btn action-delete';
      btn.title = '删除此例句';
      btn.dataset.mode = 'delete';
    } else {
      if (currentSentence) {
        btn.innerHTML = '💬';
        btn.className = 'action-btn action-add';
        btn.title = '添加例句';
        btn.dataset.mode = 'add';
      } else {
        btn.style.display = 'none';
      }
    }
  }

  // --- Add Word ---
  function addWord(word) {
    if (!isLoggedIn) return;
    const btn = document.getElementById('wordBtn');
    if (btn) btn.innerHTML = '⏳';

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
    const btn = document.getElementById('wordBtn');
    if (btn) btn.innerHTML = '⏳';

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
        // Update sentence button
        if (currentSentence) {
          updateSentenceBtn('add');
        }
        // Notify parent page to remove underline for this word
        window.parent.postMessage({
          methodName: 'removeUnderline',
          word: word
        }, '*');
      }
    });
  }

  // --- Add Sentence ---
  function addSentence(word, sentence, url) {
    if (!sentence) return;

    const btn = document.getElementById('sentenceBtn');
    if (btn) btn.innerHTML = '⏳';

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

    const btn = document.getElementById('sentenceBtn');
    if (btn) btn.innerHTML = '⏳';

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
      window.parent.postMessage({ methodName: 'langeasyLexisSetHeight', height: height }, '*');
    }
  }

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
  function handleDefinition(data) {
    const { word, sentence, url, info } = data;
    buildUI(word, sentence, url, info);

    // Fetch word definition from remote API
    fetch('https://langeasy.com.cn/loadLexisList.action?strict=1&word=' + encodeURIComponent(word))
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (result && result.wordlist && result.wordlist.length > 0) {
          const w = result.wordlist[0];
          const lines = w.interpret.split(/\r?\n/);
          document.getElementById('uk_pron').innerHTML = w.uk_pron;
          document.getElementById('us_pron').innerHTML = w.us_pron;
          const interpretDiv = document.getElementById('interpret');
          interpretDiv.innerHTML = '';
          lines.forEach(function (line) {
            const p = document.createElement('p');
            p.className = 'langeasyline';
            p.innerHTML = line;
            interpretDiv.appendChild(p);
          });
          // Set audio alt
          document.querySelectorAll('.langeasy_icon_audio').forEach(function (el) {
            el.setAttribute('alt', w.word);
          });
          // Update iframe height after definition content renders
          updateHeight();
        } else {
          document.getElementById('interpret').innerHTML = '没有找到该单词';
          updateHeight();
        }
      })
      .catch(function (e) {
        console.log('Error fetching definition', e);
        document.getElementById('interpret').innerHTML = '查询失败';
        updateHeight();
      });
  }

  // --- Listen for messages from content script ---
  window.addEventListener('message', function (e) {
    const data = e.data;
    if (data.methodName === 'innerHTML' && data.word) {
      handleDefinition(data);
    }
  }, false);

})();
