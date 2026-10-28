// ===== 例句管理页 =====
// 展示单词本中的单词及所有拥有例句的单词，支持删除单词 / 删除例句。
import { escapeHtml, formatUrl } from "./shared/dom.js";

// --- Load and Display Data ---
function loadData() {
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
    loading.style.display = 'none';

    if (response && response.method === 'getAllWordsAndSentencesResult') {
      const wordbook = response.wordbook || {};
      const sentences = response.sentences || [];

      // Group sentences by word
      const sentencesByWord = {};
      sentences.forEach(function (s) {
        if (!sentencesByWord[s.word]) {
          sentencesByWord[s.word] = [];
        }
        sentencesByWord[s.word].push(s);
      });

      // Collect all words that appear in the wordbook or have sentences
      const allWords = new Set([...Object.keys(wordbook), ...Object.keys(sentencesByWord)]);
      const words = Array.from(allWords).sort();

      // Update stats
      stats.textContent = Object.keys(wordbook).length + ' 个单词，' + sentences.length + ' 条例句';

      if (words.length === 0) {
        emptyState.style.display = 'block';
        return;
      }

      // Render each word
      words.forEach(function (word) {
        const inWordbook = !!wordbook[word];
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

        if (inWordbook) {
          const deleteWordBtn = document.createElement('button');
          deleteWordBtn.className = 'delete-btn delete-word-btn';
          deleteWordBtn.innerHTML = '删除单词';
          deleteWordBtn.title = '从单词本删除';
          deleteWordBtn.addEventListener('click', function () {
            deleteWord(word);
          });
          wordHeader.appendChild(deleteWordBtn);
        }

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
              deleteSentence(s.id, word);
            });

            sentenceItem.appendChild(sentenceText);
            sentenceItem.appendChild(sentenceMeta);
            sentenceItem.appendChild(deleteSentenceBtn);
            sentenceList.appendChild(sentenceItem);
          });

          wordDiv.appendChild(sentenceList);
        } else {
          const noSentences = document.createElement('div');
          noSentences.className = 'no-sentences';
          noSentences.textContent = '暂无例句';
          wordDiv.appendChild(noSentences);
        }

        wordList.appendChild(wordDiv);
      });
    }
  });
}

// --- Delete Word ---
function deleteWord(word) {
  const btn = event.target;
  btn.innerHTML = '处理中…';

  chrome.runtime.sendMessage({
    source: 'langeasyManage',
    method: 'removeWord',
    word: word
  }, function (response) {
    if (response && response.method === 'removeWordResult') {
      // Reload the entire list
      loadData();
    }
  });
}

// --- Delete Sentence ---
function deleteSentence(sentenceId, word) {
  const btn = event.target;
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
  loadData();
});
