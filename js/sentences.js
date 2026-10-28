// ===== 例句管理页 =====
// 仅展示拥有例句的单词，支持按单词批量删除或单条删除例句。
import { formatUrl } from "./shared/dom.js";
import { STORAGE_KEYS } from "./shared/constants.js";

let latestLoadId = 0;

// --- Load and Display Data ---
function loadData() {
  const loadId = ++latestLoadId;
  const loading = document.getElementById('loading');
  const wordList = document.getElementById('wordList');
  const emptyState = document.getElementById('emptyState');
  const stats = document.getElementById('stats');

  loading.style.display = 'block';
  wordList.innerHTML = '';
  emptyState.style.display = 'none';

  chrome.runtime.sendMessage({
    source: 'langeasyManage',
    method: 'getAllWordsAndSentences'
  }, function (response) {
    // Ignore older responses when several storage changes trigger loads together.
    if (loadId !== latestLoadId) return;
    loading.style.display = 'none';

    if (response && response.method === 'getAllWordsAndSentencesResult') {
      const sentences = response.sentences || [];

      // Group sentences by word
      const sentencesByWord = {};
      sentences.forEach(function (s) {
        if (!sentencesByWord[s.word]) {
          sentencesByWord[s.word] = [];
        }
        sentencesByWord[s.word].push(s);
      });

      // Only show words with saved sentences; wordbook entries remain independent.
      const words = Object.keys(sentencesByWord).sort();

      // Update stats
      stats.textContent = words.length + ' 个单词，' + sentences.length + ' 条例句';

      if (words.length === 0) {
        emptyState.style.display = 'block';
        return;
      }

      // Render each word
      words.forEach(function (word) {
        const wordSentences = sentencesByWord[word] || [];
        const wordDiv = document.createElement('div');
        wordDiv.className = 'word-card';

        // Word header with delete button
        const wordHeader = document.createElement('div');
        wordHeader.className = 'word-header';

        const wordTitle = document.createElement('span');
        wordTitle.className = 'word-title';
        wordTitle.textContent = word;

        const wordCount = document.createElement('span');
        wordCount.className = 'word-count';
        wordCount.textContent = wordSentences.length + ' 条例句';

        wordHeader.appendChild(wordTitle);
        wordHeader.appendChild(wordCount);

        const deleteAllBtn = document.createElement('button');
        deleteAllBtn.className = 'delete-btn delete-word-btn';
        deleteAllBtn.textContent = '删除所有例句';
        deleteAllBtn.title = '删除该单词在所有网页收藏的例句，保留生词本中的单词';
        deleteAllBtn.addEventListener('click', function () {
          if (confirm('删除 ' + word + ' 在所有网页收藏的全部例句？')) {
            deleteAllSentences(word, deleteAllBtn);
          }
        });
        wordHeader.appendChild(deleteAllBtn);

        wordDiv.appendChild(wordHeader);

        // Sentences list
        if (wordSentences.length > 0) {
          const sentenceList = document.createElement('div');
          sentenceList.className = 'sentence-list';

          wordSentences.forEach(function (s) {
            const sentenceItem = document.createElement('div');
            sentenceItem.className = 'sentence-item';

            const sentenceText = document.createElement('div');
            sentenceText.className = 'sentence-text';
            sentenceText.textContent = '"' + s.text + '"';

            const sentenceMeta = document.createElement('div');
            sentenceMeta.className = 'sentence-meta';

            if (s.url) {
              const urlLink = document.createElement('a');
              urlLink.className = 'sentence-url';
              urlLink.href = s.url;
              urlLink.target = '_blank';
              urlLink.textContent = '-> ' + formatUrl(s.url, 50);
              sentenceMeta.appendChild(urlLink);
            }

            const dateSpan = document.createElement('span');
            dateSpan.className = 'sentence-date';
            dateSpan.textContent = new Date(s.addedAt).toLocaleDateString();
            sentenceMeta.appendChild(dateSpan);

            const deleteSentenceBtn = document.createElement('button');
            deleteSentenceBtn.className = 'delete-btn delete-sentence-btn';
            deleteSentenceBtn.innerHTML = '删除';
            deleteSentenceBtn.title = '删除此例句';
            deleteSentenceBtn.addEventListener('click', function () {
              deleteSentence(s.id, deleteSentenceBtn);
            });

            sentenceItem.appendChild(sentenceText);
            sentenceItem.appendChild(sentenceMeta);
            sentenceItem.appendChild(deleteSentenceBtn);
            sentenceList.appendChild(sentenceItem);
          });

          wordDiv.appendChild(sentenceList);
        }

        wordList.appendChild(wordDiv);
      });
    }
  });
}

// --- Delete all sentences for a word ---
function deleteAllSentences(word, btn) {
  btn.innerHTML = '处理中…';

  chrome.runtime.sendMessage({
    source: 'langeasyManage',
    method: 'removeWordSentences',
    word: word
  }, function (response) {
    if (response && response.method === 'removeWordSentencesResult') {
      // Reload the entire list
      loadData();
    }
  });
}

// --- Delete Sentence ---
function deleteSentence(sentenceId, btn) {
  btn.innerHTML = '处理中…';

  chrome.runtime.sendMessage({
    source: 'langeasyManage',
    method: 'removeSentence',
    sentenceId: sentenceId
  }, function (response) {
    if (response && response.method === 'removeSentenceResult') {
      // Reload the entire list
      loadData();
    }
  });
}

// --- Init ---
document.addEventListener('DOMContentLoaded', function () {
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === 'local' &&
        changes[STORAGE_KEYS.SENTENCES]) {
      loadData();
    }
  });
  loadData();
});
