// ===== Translation Module (merged from trans_plugin) =====
// Handles right-click "段落翻译": translate selection and inject below it
// Accent left border is clickable → shows vendor selector → re-translates on selection
(function () {
  'use strict';

  const TRANSLATION_CLASS = "xt-translation";
  const MENU_CLASS = "xt-vendor-menu";
  const GROUP_ATTR = "data-xt-group";
  const MAX_TRANSLATION_CONCURRENCY = 3;
  const MODULE_START_DELAY_MS = 100;
  let vendorMenuRequest = 0;
  let vendorMenuContext = null;

  function sendMsg(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (resp) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp);
      });
    });
  }

  function ensureStyle() {
    if (document.getElementById("xt-style")) return;
    const s = document.createElement("style");
    s.id = "xt-style";
    s.textContent = `
.xt-translation {
  display: block;
  margin: 8px 0;
  padding: 8px 28px 8px 20px;
  border-radius: 0 8px 8px 0;
  border-left: 3px solid #a34f36;
  background: rgba(163, 79, 54, 0.045);
  font-size: 0.95em;
  line-height: 1.6;
  word-break: break-word;
  position: relative;
  cursor: default;
}
.xt-translation .xt-vendor-trigger {
  position: absolute;
  left: -1px;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: pointer;
  opacity: 0.3;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #a34f36;
  user-select: none;
}
.xt-translation .xt-vendor-trigger::before {
  content: "▸";
  font-size: 8px;
}
.xt-translation:hover .xt-vendor-trigger {
  opacity: 1;
}
.xt-translation .xt-vendor-trigger:hover {
  opacity: 1;
  background: rgba(163, 79, 54, 0.10);
  border-radius: 2px 0 0 2px;
}
.xt-translation .xt-close-btn {
  position: absolute;
  top: 2px;
  right: 4px;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  font-size: 14px;
  color: #a34f36;
  cursor: pointer;
  opacity: 0.35;
  transition: opacity 0.15s;
  user-select: none;
  border-radius: 50%;
}
.xt-translation:hover .xt-close-btn {
  opacity: 0.7;
}
.xt-translation .xt-close-btn:hover {
  opacity: 1;
  background: rgba(163, 79, 54, 0.10);
}

/* Vendor menu popup */
.xt-vendor-menu {
  position: fixed;
  z-index: 2147483647;
  min-width: 110px;
  background: #fffefa;
  border: 1px solid #e6e2da;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  padding: 5px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.xt-vendor-menu .xt-vendor-item {
  display: block;
  position: relative;
  width: 100%;
  padding: 6px 14px 6px 30px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  color: #302e2b;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
}
.xt-vendor-menu .xt-vendor-item:hover {
  background: #f3e9e1;
  color: #a34f36;
}
.xt-vendor-menu .xt-vendor-item.xt-vendor-active {
  font-weight: 600;
  color: #a34f36;
}
.xt-vendor-menu .xt-vendor-item.xt-vendor-active::before {
  content: "✓";
  position: absolute;
  left: 8px;
  top: 6px;
  width: 16px;
  text-align: center;
}
.xt-toast {
  position: fixed;
  z-index: 2147483647;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(42, 43, 46, 0.92);
  color: #fff;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}`;
    (document.head || document.documentElement).appendChild(s);
  }

  function showToast(msg) {
    ensureStyle();
    const t = document.createElement("div");
    t.className = "xt-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    let timer = setTimeout(function () { t.remove(); }, 2000);
    t.addEventListener('mouseenter', function () { clearTimeout(timer); });
    t.addEventListener('mouseleave', function () {
      timer = setTimeout(function () { t.remove(); }, 2000);
    });
  }

  function generateAnchorId() {
    return "xt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  function findNextElementSibling(node, className) {
    let sib = node.nextSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE) {
        if (!className || (sib.classList && sib.classList.contains(className))) return sib;
        return null;
      }
      sib = sib.nextSibling;
    }
    return null;
  }

  function findPrevElementSibling(node) {
    let sib = node.previousSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE) return sib;
      sib = sib.previousSibling;
    }
    return null;
  }

  // --- Multi-module selection helpers ---
  function getCommonElement(range) {
    var container = range.commonAncestorContainer;
    if (container && container.nodeType === Node.TEXT_NODE) {
      container = container.parentElement;
    }
    return container;
  }

  function isModuleElement(el) {
    if (!el || !el.tagName) return false;

    // Never treat our own translation blocks as modules — they can be inserted
    // inside a module and would otherwise shadow the real module on re-selection.
    if (el.classList && el.classList.contains(TRANSLATION_CLASS)) return false;

    // Standard block-level tags
    if (BLOCK_TAG_SET.has(el.tagName)) return true;

    // Semantic paragraph markers (e.g. <span data-as="p">)
    if (el.getAttribute("data-as") === "p") return true;
    if (el.getAttribute("role") === "paragraph") return true;

    // Block-like computed display
    try {
      var display = window.getComputedStyle(el).display;
      if (display === "block" || display === "list-item" ||
          display === "flex" || display === "grid" ||
          display === "table" || display === "table-cell") {
        return true;
      }
    } catch (e) {
      // ignore
    }

    return false;
  }

  function intersectRange(range, node) {
    var nodeRange = document.createRange();
    try {
      nodeRange.selectNodeContents(node);
    } catch (e) {
      return null;
    }

    try {
      // Overlap: range.end > node.start AND range.start < node.end
      if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0 &&
          range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0) {
        var sub = range.cloneRange();
        if (range.compareBoundaryPoints(Range.START_TO_START, nodeRange) < 0) {
          sub.setStart(nodeRange.startContainer, nodeRange.startOffset);
        }
        if (range.compareBoundaryPoints(Range.END_TO_END, nodeRange) > 0) {
          sub.setEnd(nodeRange.endContainer, nodeRange.endOffset);
        }
        return sub;
      }
    } catch (e) {
      // fall back to whole-node range below
    }

    // Fallback: if the range intersects the node, return the whole node range
    if (range.intersectsNode(node)) {
      return nodeRange;
    }

    return null;
  }

  function getSelectedModules(range) {
    var ancestor = getCommonElement(range);
    if (!ancestor) return [];

    // Walk all descendants of the common ancestor and pick the deepest
    // block-like modules intersected by the range. This prefers <li> over <ul>,
    // <p> over wrapper <div>, and <span data-as="p"> over its containers.
    var all = [];
    try {
      var treeWalker = document.createTreeWalker(
        ancestor,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: function (node) {
            if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
            if (node.classList && node.classList.contains(TRANSLATION_CLASS)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (isModuleElement(node)) return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      var node;
      while ((node = treeWalker.nextNode())) {
        all.push(node);
      }
    } catch (e) {
      return [];
    }

    // Keep only deepest modules (not ancestors of other modules)
    var deepest = all.filter(function (el) {
      if (el === ancestor) return false;
      for (var i = 0; i < all.length; i++) {
        var other = all[i];
        if (other !== el && el.contains(other)) return false;
      }
      return true;
    });

    if (deepest.length === 0) return [];

    // Sort by document order
    deepest.sort(function (a, b) {
      var position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return deepest.map(function (el) {
      var subRange = intersectRange(range, el);
      if (!subRange) return null;
      var t = subRange.toString();
      if (!t || !t.trim()) return null;
      return { el: el, range: subRange };
    }).filter(Boolean);
  }

  function isMultiModuleSelection(range) {
    var modules = getSelectedModules(range);
    if (modules.length === 0) return false;
    if (modules.length >= 2) return true;
    // Single block found but selection may start/end outside it
    var mod = modules[0];
    try {
      return !mod.el.contains(range.startContainer) ||
             !mod.el.contains(range.endContainer);
    } catch (e) {
      return true;
    }
  }

  // Check if selection range is within a translation block
  function getSelectionTranslationEl(range) {
    const pick = function (node) {
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      return el ? el.closest("." + TRANSLATION_CLASS) : null;
    };
    return pick(range.startContainer) || pick(range.endContainer);
  }

  // Find translation block(s) associated with a module element.
  // The anchor may have been inserted inside the module (preferred) or, if the
  // browser re-parented it, as a sibling after the module.
  function findTranslationsForModule(el) {
    if (!el) return [];
    var blocks = [];
    var anchorIds = [];

    function addBlock(block) {
      if (block && blocks.indexOf(block) === -1) blocks.push(block);
    }

    function addAnchorId(id) {
      if (id && anchorIds.indexOf(id) === -1) anchorIds.push(id);
    }

    // Case 1: anchor inside the module
    var innerAnchors = el.querySelectorAll('span[data-xt-anchor]');
    innerAnchors.forEach(function (anchor) {
      addAnchorId(anchor.dataset.xtAnchor);
    });

    // Case 2: anchor as sibling after the module (some block parents auto-close)
    var sib = el.nextSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE) {
        if (sib.classList && sib.classList.contains(TRANSLATION_CLASS)) {
          addBlock(sib);
          break;
        }
        if (sib.dataset && sib.dataset.xtAnchor) {
          addAnchorId(sib.dataset.xtAnchor);
          var trans = sib.nextSibling;
          while (trans) {
            if (trans.nodeType === Node.ELEMENT_NODE) {
              if (trans.classList && trans.classList.contains(TRANSLATION_CLASS) &&
                  trans.dataset.xtAnchor === sib.dataset.xtAnchor) {
                addBlock(trans);
              }
              break;
            }
            trans = trans.nextSibling;
          }
          break;
        }
      }
      sib = sib.nextSibling;
    }

    // Resolve blocks by anchor id
    anchorIds.forEach(function (id) {
      var block = document.querySelector('div[data-xt-anchor="' + id + '"].' + TRANSLATION_CLASS);
      addBlock(block);
    });

    return blocks;
  }

  // Legacy single-block scan used as fallback when no block siblings are detected.
  function findExistingTranslationFallback(range) {
    var probe = document.createElement("span");
    var result = null;

    // Scan forward from selection end
    var endR = range.cloneRange();
    endR.collapse(false);
    endR.insertNode(probe);
    var node = probe.nextSibling;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains(TRANSLATION_CLASS)) {
          result = node;
          break;
        }
        if (node.dataset && node.dataset.xtAnchor) {
          var trans = findNextElementSibling(node, TRANSLATION_CLASS);
          if (trans && trans.dataset.xtAnchor === node.dataset.xtAnchor) {
            result = trans;
            break;
          }
        }
      }
      node = node.nextSibling;
    }
    probe.remove();
    if (result) return result;

    // Scan backward from selection start
    var startR = range.cloneRange();
    startR.collapse(true);
    startR.insertNode(probe);
    node = probe.previousSibling;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains(TRANSLATION_CLASS)) {
          var anchor = findPrevElementSibling(node);
          if (anchor && anchor.dataset && anchor.dataset.xtAnchor &&
              anchor.dataset.xtAnchor === node.dataset.xtAnchor) {
            result = node;
            break;
          }
        }
      }
      node = node.previousSibling;
    }
    probe.remove();
    return result;
  }

  // Find all existing translation blocks associated with the current selection.
  function findExistingTranslations(range) {
    var inTrans = getSelectionTranslationEl(range);
    if (inTrans) return [inTrans];

    var modules = getSelectedModules(range);
    var results = [];

    if (modules.length > 0) {
      modules.forEach(function (mod) {
        var blocks = findTranslationsForModule(mod.el);
        blocks.forEach(function (block) {
          if (block && results.indexOf(block) === -1) results.push(block);
        });
      });

      // Include all blocks sharing the same group id
      if (results.length > 0) {
        var groups = [];
        results.forEach(function (b) {
          var g = b.getAttribute(GROUP_ATTR);
          if (g && groups.indexOf(g) === -1) groups.push(g);
        });
        if (groups.length > 0) {
          var allBlocks = Array.prototype.slice.call(
            document.querySelectorAll("." + TRANSLATION_CLASS)
          );
          allBlocks.forEach(function (b) {
            var g = b.getAttribute(GROUP_ATTR);
            if (g && groups.indexOf(g) !== -1 && results.indexOf(b) === -1) {
              results.push(b);
            }
          });
        }
      }
    }

    if (results.length > 0) return results;

    var single = findExistingTranslationFallback(range);
    return single ? [single] : [];
  }

  // --- Vendor Menu ---
  function hideVendorMenu() {
    vendorMenuRequest++;
    vendorMenuContext = null;
    var menu = document.querySelector("." + MENU_CLASS);
    if (menu) menu.remove();
  }

  async function showVendorMenu(translationEl, clientX, clientY) {
    hideVendorMenu();
    var request = vendorMenuRequest;
    vendorMenuContext = { translationEl: translationEl, clientX: clientX, clientY: clientY };

    var resp = await sendMsg({ action: 'getVendors' });
    if (request !== vendorMenuRequest || !translationEl.isConnected) return;
    if (!resp || !resp.ok || !Array.isArray(resp.vendors)) {
      hideVendorMenu();
      showToast('获取翻译源失败，请重试');
      return;
    }
    var vendors = resp.vendors;
    if (!vendors.length) {
      hideVendorMenu();
      showToast('请先在扩展侧边栏添加翻译源');
      return;
    }

    var menu = document.createElement("div");
    menu.className = MENU_CLASS;
    menu.style.left = clientX + "px";
    menu.style.top = clientY + "px";

    var currentVendor = translationEl.dataset.xtVendor || "youdao";

    vendors.forEach(function (v) {
      var btn = document.createElement("button");
      btn.className = "xt-vendor-item";
      if (v.id === currentVendor) btn.className += " xt-vendor-active";
      btn.textContent = v.name;
      btn.dataset.vendorId = v.id;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var vendorId = this.dataset.vendorId;
        if (vendorId === currentVendor) { hideVendorMenu(); return; }
        reTranslate(translationEl, vendorId);
        hideVendorMenu();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Keep menu within viewport
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 8) + "px";
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (clientY - rect.height - 4) + "px";
    }
  }

  // Re-translate with a new vendor
  function reTranslate(translationEl, vendorId) {
    var chunks = [];
    try {
      chunks = JSON.parse(translationEl.dataset.xtChunks || "[]");
    } catch (e) {
      chunks = [];
    }
    var hasChunks = chunks && chunks.length;
    var originalText = translationEl.dataset.xtOriginal;
    var maskedText = translationEl.dataset.xtMask;
    var textToSend = hasChunks ? maskedText : originalText;
    if (!textToSend) return;

    var previousVendor = translationEl.dataset.xtVendor || "youdao";

    // Preserve current content so we can restore it on error
    var previousContent = document.createDocumentFragment();
    while (translationEl.firstChild) {
      previousContent.appendChild(translationEl.firstChild);
    }
    translationEl.dataset.xtVendor = vendorId;
    translationEl.textContent = "翻译中...";

    sendMsg({ action: "translate", text: textToSend, vendor: vendorId })
      .then(function (resp) {
        if (resp && resp.ok && resp.translation) {
          translationEl.textContent = "";
          if (hasChunks) {
            translationEl.appendChild(buildRestoredFragment(resp.translation, chunks));
          } else {
            translationEl.textContent = resp.translation;
          }
          addVendorTrigger(translationEl);
          addCloseButton(translationEl);
          translationEl.dataset.xtVendor = vendorId;
          // Save selected vendor globally
          sendMsg({ action: "setSelectedVendor", vendor: vendorId });
        } else {
          // Restore previous content
          translationEl.textContent = "";
          translationEl.appendChild(previousContent);
          addVendorTrigger(translationEl);
          addCloseButton(translationEl);
          translationEl.dataset.xtVendor = previousVendor;
          showToast("翻译失败：" + (resp?.error || "未知错误"));
        }
      });
  }

  // Add the clickable vendor trigger to a translation block
  function addVendorTrigger(div) {
    // Remove existing trigger if any
    var existing = div.querySelector(".xt-vendor-trigger");
    if (existing) existing.remove();

    var trigger = document.createElement("span");
    trigger.className = "xt-vendor-trigger";
    trigger.title = "切换翻译源";
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var rect = div.getBoundingClientRect();
      showVendorMenu(div, rect.left, rect.bottom + 2);
    });
    div.insertBefore(trigger, div.firstChild);
  }

  // Add a close button that removes the translation block and its anchor
  function addCloseButton(div) {
    var existing = div.querySelector(".xt-close-btn");
    if (existing) existing.remove();

    var btn = document.createElement("span");
    btn.className = "xt-close-btn";
    btn.textContent = "×";
    btn.title = "关闭翻译";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      hideVendorMenu();
      var anchorId = div.dataset.xtAnchor;
      if (anchorId) {
        var anchor = document.querySelector('span[data-xt-anchor="' + anchorId + '"]');
        if (anchor) anchor.remove();
      }
      div.remove();
    });
    div.appendChild(btn);
  }

  // Insert translation block after selection end
  function insertTranslation(range, translation, vendorId, maskedText, chunks) {
    var anchorId = generateAnchorId();
    var anchor = document.createElement("span");
    anchor.dataset.xtAnchor = anchorId;
    anchor.style.cssText = "display:inline-block;width:0;height:0;overflow:hidden;";

    var div = document.createElement("div");
    div.className = TRANSLATION_CLASS;
    div.dataset.xtAnchor = anchorId;
    div.dataset.xtVendor = vendorId || "youdao";

    // Store original text for re-translation
    var sel = window.getSelection();
    var originalText = sel ? sel.toString() : "";
    div.dataset.xtOriginal = originalText;

    if (chunks && chunks.length) {
      div.dataset.xtMask = maskedText || "";
      div.dataset.xtChunks = JSON.stringify(chunks);
      div.textContent = "";
      div.appendChild(buildRestoredFragment(translation, chunks));
    } else {
      div.textContent = translation;
    }

    // Detect the original selected text's color and apply it to the translation
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      var colorNode = r.startContainer.nodeType === Node.TEXT_NODE
        ? r.startContainer.parentElement
        : r.startContainer;
      if (colorNode) {
        var computed = getComputedStyle(colorNode);
        div.style.color = computed.color;
      }
    }

    var r = range.cloneRange();
    r.collapse(false);
    r.insertNode(anchor);
    anchor.parentNode.insertBefore(div, anchor.nextSibling);

    // Add the clickable vendor trigger and close button
    addVendorTrigger(div);
    addCloseButton(div);
  }

  // Remove a translation block and its paired anchor span
  function removeTranslationBlock(translationEl) {
    var anchorId = translationEl.dataset.xtAnchor;
    if (anchorId) {
      var anchor = document.querySelector('span[data-xt-anchor="' + anchorId + '"]');
      if (anchor && anchor !== translationEl) anchor.remove();
    }
    translationEl.remove();
  }

  // Insert a translation block at the end of a module's content.
  // This keeps the translation visually close to the original text, matching
  // the single-selection insertion behavior in insertTranslation().
  function insertModuleTranslation(moduleEl, range, translation, vendorId, maskedText, chunks, groupId) {
    var anchorId = generateAnchorId();

    var anchor = document.createElement("span");
    anchor.dataset.xtAnchor = anchorId;
    anchor.setAttribute(GROUP_ATTR, groupId);
    anchor.style.cssText = "display:inline-block;width:0;height:0;overflow:hidden;";

    var div = document.createElement("div");
    div.className = TRANSLATION_CLASS;
    div.dataset.xtAnchor = anchorId;
    div.setAttribute(GROUP_ATTR, groupId);
    div.dataset.xtVendor = vendorId || "youdao";
    div.dataset.xtOriginal = range.toString();

    if (chunks && chunks.length) {
      div.dataset.xtMask = maskedText || "";
      div.dataset.xtChunks = JSON.stringify(chunks);
      div.textContent = "";
      div.appendChild(buildRestoredFragment(translation, chunks));
    } else {
      div.textContent = translation;
    }

    var colorNode = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
    if (colorNode) {
      div.style.color = getComputedStyle(colorNode).color;
    }

    // Insert at the end of the module's content, just like single-selection does.
    var r = document.createRange();
    r.selectNodeContents(moduleEl);
    r.collapse(false);
    r.insertNode(anchor);
    anchor.parentNode.insertBefore(div, anchor.nextSibling);

    addVendorTrigger(div);
    addCloseButton(div);
  }

  // Translate a list of module items with limited concurrency and a small delay between starts
  async function translateModules(items, vendorId) {
    var results = new Array(items.length);
    var next = 0;

    async function worker() {
      while (next < items.length) {
        var i = next++;
        var text = items[i].maskedText || items[i].originalText || "";
        try {
          results[i] = await sendMsg({ action: "translate", text: text, vendor: vendorId });
        } catch (e) {
          results[i] = { ok: false, error: String(e) };
        }
        if (next < items.length) {
          await new Promise(function (resolve) { setTimeout(resolve, MODULE_START_DELAY_MS); });
        }
      }
    }

    var workers = [];
    var poolSize = Math.min(MAX_TRANSLATION_CONCURRENCY, items.length);
    for (var i = 0; i < poolSize; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  // Keep an open page menu in sync with source edits, deletions and ordering.
  // Storage keys mirror translator/index.js and shared/constants.js (content scripts cannot import).
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'local' || !vendorMenuContext) return;
    if (!['xtCustomVendors', 'xtBuiltinVendorSettings', 'xtVendorOrder'].some(function (key) {
      return Object.prototype.hasOwnProperty.call(changes, key);
    })) return;
    var context = vendorMenuContext;
    showVendorMenu(context.translationEl, context.clientX, context.clientY);
  });

  // Global click to hide vendor menu
  document.addEventListener("click", function (e) {
    if (!e.target.closest("." + MENU_CLASS) && !e.target.closest(".xt-vendor-trigger")) {
      hideVendorMenu();
    }
  });

  // Tags whose content should not be translated; they are replaced by placeholders.
  const DEFAULT_INLINE_ALLOWLIST = new Set([
    "CODE", "KBD", "SAMP", "VAR", "MARK", "TT"
  ]);
  const BLOCK_TAG_SET = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DETAILS", "DIALOG", "DD",
    "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
    "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "LI", "MAIN",
    "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH",
    "THEAD", "TITLE", "TR", "UL"
  ]);
  const PLACEHOLDER_PREFIX = "{{XT_";
  const PLACEHOLDER_SUFFIX = "}}";
  const PLACEHOLDER_RE = /\{\{XT_(\d+)\}\}/g;

  function isDangerousUrl(value) {
    if (typeof value !== "string") return false;
    var trimmed = value.trim().toLowerCase();
    return trimmed.indexOf("javascript:") === 0 || trimmed.indexOf("data:") === 0;
  }

  function sanitizeChunkElement(el) {
    if (!el) return el;
    var tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME" || tag === "NOSCRIPT") {
      return document.createTextNode(el.outerHTML || "");
    }
    var attrs = el.attributes;
    for (var i = attrs.length - 1; i >= 0; i--) {
      var attr = attrs[i];
      var name = attr.name;
      if (name.indexOf("on") === 0) {
        el.removeAttribute(name);
      } else if ((name === "href" || name === "src" || name === "action" || name === "formaction") &&
                 isDangerousUrl(attr.value)) {
        el.removeAttribute(name);
      }
    }
    var child = el.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === Node.ELEMENT_NODE) {
        var replacement = sanitizeChunkElement(child);
        if (replacement !== child) {
          el.replaceChild(replacement, child);
        }
      }
      child = next;
    }
    return el;
  }

  function parseHtmlChunk(outerHTML) {
    var template = document.createElement("template");
    template.innerHTML = outerHTML;
    var el = template.content.firstChild;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
      return document.createTextNode(outerHTML || "");
    }
    return sanitizeChunkElement(el);
  }

  function buildRestoredFragment(maskedTranslation, chunks) {
    var fragment = document.createDocumentFragment();
    var lastIndex = 0;
    var match;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((match = PLACEHOLDER_RE.exec(maskedTranslation)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(maskedTranslation.slice(lastIndex, match.index)));
      }
      var id = parseInt(match[1], 10);
      var chunk = chunks[id];
      if (chunk && chunk.outerHTML) {
        fragment.appendChild(parseHtmlChunk(chunk.outerHTML));
      } else {
        fragment.appendChild(document.createTextNode(match[0]));
      }
      lastIndex = PLACEHOLDER_RE.lastIndex;
    }
    if (lastIndex < maskedTranslation.length) {
      fragment.appendChild(document.createTextNode(maskedTranslation.slice(lastIndex)));
    }
    return fragment;
  }

  function extractMaskedSelection(range) {
    var fragment = range.cloneContents();
    var chunks = [];
    var parts = [];
    var placeholderId = 0;

    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) parts.push(node.textContent);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      var tag = node.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
      if (tag === "BR") {
        parts.push("\n");
        return;
      }

      if (DEFAULT_INLINE_ALLOWLIST.has(tag)) {
        var clone = node.cloneNode(true);
        chunks.push({ id: placeholderId, outerHTML: clone.outerHTML });
        parts.push(PLACEHOLDER_PREFIX + placeholderId + PLACEHOLDER_SUFFIX);
        placeholderId++;
        return;
      }

      if (BLOCK_TAG_SET.has(tag)) {
        parts.push("\n");
      }
      var child = node.firstChild;
      while (child) {
        walk(child);
        child = child.nextSibling;
      }
    }

    var child = fragment.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }

    return { maskedText: parts.join(""), chunks: chunks };
  }

  async function handleTranslateSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      showToast("请先选中要翻译的内容");
      return { skipped: true };
    }
    const range = sel.getRangeAt(0);

    // If selection already has associated translation block(s) -> remove them (revert)
    var existingBlocks = findExistingTranslations(range);
    if (existingBlocks.length > 0) {
      existingBlocks.forEach(removeTranslationBlock);
      sel.removeAllRanges();
      return { removed: true };
    }

    ensureStyle();

    // Get the currently selected translation vendor
    const vendorResp = await sendMsg({ action: "getSelectedVendor" });
    const vendorId = (vendorResp && vendorResp.ok && vendorResp.vendor) || "";

    // Multi-module path: translate each sibling block separately and insert after it
    if (isMultiModuleSelection(range)) {
      var modules = getSelectedModules(range);
      var items = modules.map(function (mod) {
        var extracted = extractMaskedSelection(mod.range);
        return {
          el: mod.el,
          range: mod.range,
          originalText: mod.range.toString(),
          maskedText: extracted.maskedText,
          chunks: extracted.chunks
        };
      }).filter(function (it) {
        return (it.maskedText || it.originalText || "").trim().length > 0;
      });

      if (items.length === 0) {
        showToast("请先选中要翻译的内容");
        return { skipped: true };
      }

      var results = await translateModules(items, vendorId);
      var groupId = generateAnchorId();
      var inserted = 0;
      var failed = 0;

      results.forEach(function (resp, i) {
        if (resp && resp.ok && resp.translation && resp.translation.trim()) {
          insertModuleTranslation(
            items[i].el,
            items[i].range,
            resp.translation,
            vendorId,
            items[i].maskedText,
            items[i].chunks,
            groupId
          );
          inserted++;
        } else {
          failed++;
        }
      });

      if (failed > 0) {
        showToast("部分模块翻译失败");
      }
      return { translated: inserted > 0 };
    }

    // Single-block / inline path
    const { maskedText, chunks } = extractMaskedSelection(range);
    const text = maskedText || sel.toString();
    if (!text.trim()) {
      showToast("请先选中要翻译的内容");
      return { skipped: true };
    }

    const resp = await chrome.runtime.sendMessage({ action: "translate", text, vendor: vendorId });
    if (!resp || !resp.ok) {
      showToast("翻译失败：" + (resp?.error || "未知错误"));
      return { error: resp?.error };
    }
    if (!resp.translation || !resp.translation.trim()) {
      showToast("未获得翻译结果");
      return { empty: true };
    }
    insertTranslation(range, resp.translation, vendorId, maskedText, chunks);
    return { translated: true };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== "translateSelection") return;
    handleTranslateSelection()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  });

})();
