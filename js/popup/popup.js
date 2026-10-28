// ===== Popup Script (core) =====
// 手动查词、登录态、单词本操作、语言选择器、发音。
// 翻译源 UI（选择器 + 增删改弹窗）见 ./vendor-ui.js。
import { HOST, AUDIO_CDN, TRANS_LANGS, TRANS_LANG_KEY, STORAGE_KEYS, LS_KEYS } from "../shared/constants.js";
import { escapeHtml, escapeQuotes, formatUrl } from "../shared/dom.js";
import { sendMsg } from "../shared/messaging.js";
import { initVendorSelector } from "./vendor-ui.js";

(function () {
  'use strict';

  let info = '';
  let currentWord = '';
  let isLoggedIn = false;
  let queryRequestId = 0;

  // --- Utility ---
  function inputFocusAuto() {
    document.getElementById('input').focus();
  }

  function clearArea(area) {
    if (area === 'definition') {
      document.getElementById('definition').style.display = 'none';
      return;
    }
    const el = document.getElementById(area);
    if (el) el.innerHTML = '';
  }

  function showTips(msg) {
    document.getElementById('tips').innerHTML = msg ? '<p>' + msg + '</p>' : '';
  }

  const transMark = escapeQuotes;

  // --- Login Status ---
  function loggedIn(name) {
    const status = document.getElementById('status');
    const userLink = document.createElement('a');
    const wordLink = document.createElement('a');
    const sep = document.createElement('span');

    userLink.setAttribute('href', HOST);
    userLink.setAttribute('target', '_newtab');
    userLink.textContent = '不背单词：' + name;
    userLink.title = '当前登录的不背单词账号';

    wordLink.setAttribute('href', HOST + '/newword');
    wordLink.setAttribute('target', '_newtab');
    wordLink.textContent = '生词表';

    sep.innerHTML = ' - ';
    clearArea('status');
    status.appendChild(wordLink);
    status.appendChild(sep);
    status.appendChild(userLink);
  }

  function loggedOut() {
    const status = document.getElementById('status');
    const loginLink = document.createElement('a');
    loginLink.setAttribute('href', HOST + '/lexis/login?redirectUrl=http%3A%2F%2Fbbdc.cn%2Fnewword');
    loginLink.setAttribute('target', '_newtab');
    loginLink.textContent = '登录不背单词 ↗';
    loginLink.title = '前往 bbdc.cn 登录，用于添加生词';
    clearArea('status');
    status.appendChild(loginLink);
    showTips('按 Enter 查询单词');
  }

  async function checkLoginStatus() {
    inputFocusAuto();
    showTips('按 Enter 查询单词');
    document.getElementById('status').textContent = '检查账号…';
    try {
      const response = await sendMsg({ type: 'bbdc:check-login' });
      const data = response?.data;
      isLoggedIn = !!(response?.ok && data?.result_code === 200);
      if (isLoggedIn) {
        loggedIn(data.data_body.name);
      } else {
        loggedOut();
      }
    } catch (e) {
      console.log('error', e);
    }
  }

  // --- Parse Input ---
  function onParse(input) {
    input = input.replace(/[^a-zA-Z ]+/g, '');
    if (input.length === 0 || input.search(/^ +$/) !== -1) return null;
    return input.replace(/ +/g, ' ').replace(/^ +| +$/g, '');
  }

  // --- Query ---
  function queryFailed(word) {
    clearArea('jump');
    clearArea('definition');
    showTips('<span class="word">' + word + '</span> 没有找到。');
  }

  async function querySuccess(data, requestId) {
    showTips('');
    const w = data.wordlist[0];
    info = w.interpret;
    info = transMark(info);

    document.getElementById('definition').style.display = 'block';

    // Word
    document.getElementById('word').innerHTML = w.word;
    currentWord = w.word;

    document.querySelectorAll('.pronunciation-row').forEach(row => { row.style.display = ''; });

    // Pronunciation
    document.getElementById('uk_pron').innerHTML = w.uk_pron;
    document.getElementById('us_pron').innerHTML = w.us_pron;
    document.getElementById('uk_audio').style.display = 'inline-block';
    document.getElementById('uk_audio').alt = w.word;
    document.getElementById('us_audio').style.display = 'inline-block';
    document.getElementById('us_audio').alt = w.word;

    // Interpret
    const interpretDiv = document.getElementById('interpret');
    interpretDiv.innerHTML = '';
    w.interpret.split(/\r?\n/).forEach(function (line) {
      const p = document.createElement('p');
      p.className = 'line';
      p.innerHTML = line;
      interpretDiv.appendChild(p);
    });

    // Word action button area
    const jumpArea = document.getElementById('jump');
    jumpArea.innerHTML = '';
    jumpArea.className = '';

    // Check local storage for word status
    try {
      const wordData = await chrome.storage.local.get(STORAGE_KEYS.WORDBOOK);
      if (requestId !== queryRequestId) return;
      const wordbook = wordData[STORAGE_KEYS.WORDBOOK] || {};
      const exists = !!wordbook[w.word];

      if (exists) {
        // Show delete button
        const delBtn = createWordDeleteBtn(w.word);
        jumpArea.appendChild(delBtn);

      } else if (isLoggedIn) {
        // Show add button
        const addBtn = createWordAddBtn(w.word);
        jumpArea.appendChild(addBtn);
      }
      // Saved sentences do not depend on wordbook membership.
      await displayStoredSentences(w.word);
    } catch (e) {
      console.log('Error checking word status', e);
    }
  }

  function wordBookmark(added) {
    return '<svg viewBox="0 0 24 24" fill="' + (added ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/></svg>' +
      '<span class="action-label">' + (added ? '已添加' : '添加单词') + '</span>';
  }

  // --- Word Add/Delete Buttons ---
  function createWordAddBtn(word) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'word-action-btn action-add';
    btn.innerHTML = wordBookmark(false);
    btn.title = '添加到不背单词生词本';
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        const response = await sendMsg({ source: 'langeasyPopup', method: 'addNewWord', word, info });
        if (!response || response.error) {
          if (response?.loginRequired) {
            isLoggedIn = false;
            loggedOut();
            document.getElementById('jump').innerHTML = '';
            return;
          }
          throw new Error('Unable to add word');
        }

        if (currentWord !== word) return;
        // Refresh - show delete button
        const jumpArea = document.getElementById('jump');
        jumpArea.innerHTML = '';
        const delBtn = createWordDeleteBtn(word);
        jumpArea.appendChild(delBtn);
        await displayStoredSentences(word);
      } catch (e) {
        console.log('Error adding word', e);
        btn.innerHTML = wordBookmark(false);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  function createWordDeleteBtn(word) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'word-action-btn action-delete';
    btn.innerHTML = wordBookmark(true);
    btn.title = '从不背单词生词本删除';
    btn.setAttribute('aria-label', '已添加，点击从生词本删除');
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        const response = await sendMsg({ source: 'langeasyPopup', method: 'removeWord', word, info });
        if (!response || response.error) throw new Error('无法删除单词');
        if (currentWord !== word) return;
        // Refresh - show add button
        const jumpArea = document.getElementById('jump');
        jumpArea.innerHTML = '';
        if (isLoggedIn) jumpArea.appendChild(createWordAddBtn(word));
        // Removing a word leaves its saved sentences intact.
        await displayStoredSentences(word);
      } catch (e) {
        console.log('Error removing word', e);
        btn.innerHTML = wordBookmark(true);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  // --- Display Stored Sentences ---
  async function displayStoredSentences(word) {
    let sentencesDiv = document.getElementById('storedSentencesSection');

    if (!sentencesDiv) {
      // Create the section
      const definition = document.getElementById('definition');
      sentencesDiv = document.createElement('div');
      sentencesDiv.id = 'storedSentencesSection';
      sentencesDiv.className = 'stored-sentences-section';
      definition.appendChild(sentencesDiv);
    }

    try {
      const data = await chrome.storage.local.get(STORAGE_KEYS.SENTENCES);
      if (currentWord !== word) return;
      const allSentences = data[STORAGE_KEYS.SENTENCES] || [];
      const wordSentences = allSentences.filter(function (s) { return s.word === word; });

      if (wordSentences.length === 0) {
        sentencesDiv.style.display = 'none';
        return;
      }

      let html = '<hr class="sentence-divider">';
      html += '<div class="sentences-header">📝 已收录例句</div>';
      html += '<div class="sentences-list">';
      wordSentences.forEach(function (s) {
        const displayUrl = formatUrl(s.url);
        html += '<div class="sentence-item">';
        html += '  <div class="sentence-text">"' + escapeHtml(s.text) + '"</div>';
        if (s.url) {
          html += '  <div class="sentence-url"><a href="' + escapeHtml(s.url) + '" target="_blank">→ ' + escapeHtml(displayUrl) + '</a></div>';
        }
        html += '</div>';
      });
      html += '</div>';

      sentencesDiv.innerHTML = html;
      sentencesDiv.style.display = 'block';
    } catch (e) {
      console.log('Error loading sentences', e);
    }
  }

  // --- Query ---
  async function onQuery(word) {
    const requestId = ++queryRequestId;
    currentWord = '';
    showTips('查询中...');
    clearArea('jump');
    clearArea('definition');
    let data = null;
    try {
      const resp = await fetch('https://langeasy.com.cn/loadLexisList.action?strict=1&word=' + encodeURIComponent(word));
      if (!resp.ok) throw new Error('词典请求失败');
      data = await resp.json();
    } catch (e) {
      console.log('error', e);
    }
    if (requestId !== queryRequestId) return;
    const entry = data?.wordlist?.find(w => w.word && typeof w.interpret === 'string' && w.interpret.trim());
    if (entry) {
      await querySuccess({ wordlist: [entry] }, requestId);
      return;
    }
    try {
      const settings = await chrome.storage.local.get(LS_KEYS.LOOKUP_FALLBACK);
      if (requestId !== queryRequestId) return;
      if (settings[LS_KEYS.LOOKUP_FALLBACK] === false) {
        queryFailed(word);
        return;
      }
      showTips('词典未查到结果，正在使用所选翻译源…');
      const response = await sendMsg({ action: 'translate', text: word });
      if (requestId !== queryRequestId) return;
      if (!response?.ok || typeof response.translation !== 'string' || !response.translation.trim()) {
        throw new Error(response?.error || '翻译接口未返回结果');
      }
      currentWord = word;
      document.getElementById('word').textContent = word;
      document.getElementById('interpret').textContent = response.translation;
      document.querySelectorAll('.pronunciation-row').forEach(row => { row.style.display = 'none'; });
      document.getElementById('definition').style.display = 'block';
      showTips('所选翻译源的翻译结果');
      await displayStoredSentences(word);
    } catch (e) {
      if (requestId !== queryRequestId) return;
      queryFailed(word);
      document.getElementById('tips').textContent = '翻译失败：' + e.message;
    }
  }

  // --- Event Handlers ---
  function onClick() {
    const input = document.getElementById('input').value;
    const parsed = onParse(input);
    if (parsed === null) {
      clearArea('jump');
      clearArea('definition');
      showTips('<span class="color">英文字符</span>和<span class="color">空格</span>为有效的关键字，请重新输入');
    } else {
      onQuery(parsed);
    }
    inputFocusAuto();
  }

  function onKeydown(e) {
    if (e.key === 'Enter') {
      const input = document.getElementById('input').value;
      const parsed = onParse(input);
      if (parsed === null) {
        clearArea('jump');
        clearArea('definition');
        showTips('<span class="color">英文字符</span>和<span class="color">空格</span>为有效的关键字，请重新输入');
      } else {
        onQuery(parsed);
      }
    }
  }

  // --- Audio ---
  let audioPlaying = false;
  function playSound(e) {
    if (audioPlaying) return;
    audioPlaying = true;
    const audio = document.createElement('audio');
    const type = e.target.getAttribute('type');
    const word = e.target.getAttribute('alt');
    const src = AUDIO_CDN + '/speeches/' + type + '/' + type + '-speech/' + word + '.mp3';
    audio.setAttribute('src', src);
    audio.play().catch(function () { audioPlaying = false; });
    audio.onerror = function () {
      audioPlaying = false;
      showMsg('发音不存在');
    };
    document.getElementById('definition').appendChild(audio);
    inputFocusAuto();
    audio.addEventListener('ended', function () {
      audioPlaying = false;
    });
  }

  function showMsg(msg) {
    const tips = document.getElementById('tips');
    clearTimeout(tips.timer);
    tips.innerHTML = msg;
    tips.style.display = 'block';
    tips.className = 'color';
    function startTimer() {
      clearTimeout(tips.timer);
      tips.timer = setTimeout(function () {
        tips.innerHTML = '';
        tips.className = '';
        tips.style.display = 'none';
      }, 3000);
    }
    startTimer();
    if (!tips._mouseHandlersAttached) {
      tips.addEventListener('mouseenter', function () { clearTimeout(tips.timer); });
      tips.addEventListener('mouseleave', startTimer);
      tips._mouseHandlersAttached = true;
    }
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', function () {
    checkLoginStatus();
    initLangSelector();
    initVendorSelector();

    document.body.addEventListener('click', function (e) {
      // 弹窗内按钮（翻译源增删改弹窗）不应触发手动查词
      if (e.target.closest('#search')) onClick();
      if (e.target.matches('#uk_audio, #us_audio')) playSound(e);
    });


    document.querySelector('input').addEventListener('keydown', onKeydown);
  });

  // --- Translation Language Selector ---
  // TRANS_LANGS / TRANS_LANG_KEY 见 ../shared/constants.js（已 import）

  function initLangSelector() {
    const row = document.getElementById('lang_row');
    const panel = document.getElementById('lang_panel');
    const currentLabel = document.getElementById('lang_current_label');
    const list = document.getElementById('lang_list');
    if (!row || !panel || !currentLabel || !list) return;

    let isOpen = false;

    function renderList(current) {
      list.innerHTML = '';
      TRANS_LANGS.forEach(function (lang) {
        const btn = document.createElement('button');
        btn.textContent = lang.label;
        if (lang.value === current) btn.classList.add('active');
        btn.addEventListener('click', function () {
          chrome.storage.local.set({ [TRANS_LANG_KEY]: lang.value }, function () {
            currentLabel.textContent = lang.label;
            renderList(lang.value);
            setOpen(false);
          });
        });
        list.appendChild(btn);
      });
    }

    function setOpen(open) {
      isOpen = open;
      row.classList.toggle('open', isOpen);
      row.setAttribute('aria-expanded', String(isOpen));
      panel.classList.toggle('open', isOpen);
    }

    row.addEventListener('click', function () { setOpen(!isOpen); });

    chrome.storage.local.get(TRANS_LANG_KEY, function (r) {
      const current = r[TRANS_LANG_KEY] || "zh-CHS";
      const lang = TRANS_LANGS.find(function (l) { return l.value === current; }) || TRANS_LANGS[0];
      currentLabel.textContent = lang.label;
      renderList(current);
    });
  }

  // Keep already-open sidebar results in sync with sentence collections.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes[STORAGE_KEYS.SENTENCES] && currentWord) {
      displayStoredSentences(currentWord);
    }
  });

})();
