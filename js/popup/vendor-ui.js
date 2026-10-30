// ===== 翻译源选择器 + 增删改弹窗 =====
// 从 popup.js 拆出：翻译源列表展示、选中切换、自定义源添加/编辑/删除弹窗。
// 支持两类自定义源：
//  - 传统机器翻译（alibaba / baidu）：协议固定，凭据字段由后台类型定义动态渲染；
//  - 大模型翻译（type: "llm"）：OpenAI 兼容 / Anthropic 协议按钮切换，
//    自填 API 接口地址 / API Key / 模型，并可修改系统提示词（prompt）。
// 自包含：仅依赖 chrome.runtime 与 DOM（外加 ../translator/llm.js 的默认值常量）。
import { LLM_DEFAULTS, LLM_PROTOCOL_LABELS, DEFAULT_LLM_PROMPT } from "../translator/llm.js";

export function initVendorSelector() {
  const row = document.getElementById('vendor_row');
  const panel = document.getElementById('vendor_panel');
  const currentLabel = document.getElementById('vendor_current_label');
  const list = document.getElementById('vendor_list');
  const addBtn = document.getElementById('add_custom_vendor');
  if (!row || !panel || !currentLabel || !list || !addBtn) return;

  let isOpen = false;
  let vendors = [];
  let draggedItem = null;
  let orderSaved = false;

  list.addEventListener('dragover', function (event) {
    if (!draggedItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    var target = event.target.closest('.vendor-item');
    if (!target || target === draggedItem) return;
    var bounds = target.getBoundingClientRect();
    list.insertBefore(draggedItem, event.clientY < bounds.top + bounds.height / 2 ? target : target.nextSibling);
  });

  list.addEventListener('drop', function (event) {
    if (!draggedItem) return;
    event.preventDefault();
    orderSaved = true;
    var ids = Array.from(list.children, function (item) { return item.dataset.vendorId; });
    chrome.runtime.sendMessage({ action: 'setVendorOrder', ids: ids }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.ok) alert('保存翻译源顺序失败');
      refreshVendorList();
    });
  });

  function refreshVendorList() {
    chrome.runtime.sendMessage({ action: 'getVendors' }, function (resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok && resp.vendors) {
        vendors = resp.vendors;
        chrome.runtime.sendMessage({ action: 'getSelectedVendor' }, function (resp2) {
          if (chrome.runtime.lastError) return;
          var current = 'youdao';
          var currentName = '请选择翻译源';
          if (resp2 && resp2.ok && resp2.vendor) {
            current = resp2.vendor;
            var found = vendors.find(function (v) { return v.id === current; });
            if (found) currentName = found.name;
          }
          currentLabel.textContent = currentName;
          renderList(current);
        });
      }
    });
  }

  function renderList(currentId) {
    list.innerHTML = '';
    vendors.forEach(function (v) {
      var item = document.createElement('div');
      item.className = 'vendor-item';
      item.dataset.vendorId = v.id;

      var handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'vendor-drag-handle';
      handle.textContent = '⠿';
      handle.title = '拖动调整顺序';
      handle.setAttribute('aria-label', '拖动调整「' + v.name + '」的顺序；也可按上下方向键');
      handle.draggable = true;
      handle.addEventListener('click', function (event) { event.stopPropagation(); });
      handle.addEventListener('dragstart', function (event) {
        draggedItem = item;
        orderSaved = false;
        item.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', v.id);
      });
      handle.addEventListener('dragend', function () {
        item.classList.remove('dragging');
        draggedItem = null;
        if (!orderSaved) refreshVendorList();
      });
      handle.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        var sibling = event.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
        if (!sibling) return;
        list.insertBefore(item, event.key === 'ArrowUp' ? sibling : sibling.nextSibling);
        var ids = Array.from(list.children, function (entry) { return entry.dataset.vendorId; });
        chrome.runtime.sendMessage({ action: 'setVendorOrder', ids: ids }, function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            alert('保存翻译源顺序失败');
            refreshVendorList();
          }
        });
        handle.focus();
      });
      item.appendChild(handle);

      var btn = document.createElement('button');
      btn.className = 'vendor-item-btn';
      btn.textContent = v.name;
      if (v.id === currentId) btn.classList.add('active');
      btn.addEventListener('click', function () {
        chrome.runtime.sendMessage({ action: 'setSelectedVendor', vendor: v.id }, function () {
          var name = v.name;
          currentLabel.textContent = name;
          renderList(v.id);
          setOpen(false);
        });
      });
      item.appendChild(btn);

      // 所有翻译源均可编辑和删除。
      {
        var editBtn = document.createElement('button');
        editBtn.className = 'vendor-item-edit';
        editBtn.textContent = '编辑';
        editBtn.title = '编辑';
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openEditModal(v.id);
        });
        item.appendChild(editBtn);

        var delBtn = document.createElement('button');
        delBtn.className = 'vendor-item-delete';
        delBtn.textContent = '删除';
        delBtn.title = '删除';
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (confirm('确定删除翻译源「' + v.name + '」吗？')) {
            deleteCustomVendorById(v.id);
          }
        });
        item.appendChild(delBtn);
      }

      list.appendChild(item);
    });
  }

  function setOpen(open) {
    isOpen = open;
    row.classList.toggle('open', isOpen);
    row.setAttribute('aria-expanded', String(isOpen));
    panel.classList.toggle('open', isOpen);
  }

  row.addEventListener('click', function () {
    var opening = !isOpen;
    setOpen(opening);
    if (opening) refreshVendorList();
  });

  // Add button handler
  addBtn.addEventListener('click', function () {
    openAddModal();
  });

  // Initial load
  refreshVendorList();

  // ---- Modal Logic ----
  var modal = document.getElementById('vendor_modal');
  var modalTitle = document.getElementById('vendor_modal_title');
  var modalNameField = document.getElementById('vendor_name_field');
  var modalName = document.getElementById('vendor_modal_name');
  var credentialFields = document.getElementById('vendor_credential_fields');
  var modalClose = document.getElementById('vendor_modal_close');
  var modalCancel = document.getElementById('vendor_modal_cancel');
  var modalSave = document.getElementById('vendor_modal_save');

  // 分类 UI：传统机器翻译 / 大模型翻译
  var tradHeader = document.getElementById('category_traditional_header');
  var traditionalOptions = document.getElementById('traditional_options');
  var llmHeader = document.getElementById('category_llm_header');
  var llmOptions = document.getElementById('llm_options');
  var typeRadios = document.querySelectorAll('input[name="vendor_type"]');

  // 大模型翻译字段
  var llmFields = document.getElementById('llm_fields');
  var llmUrl = document.getElementById('llm_url');
  var llmUrlHint = document.getElementById('llm_url_hint');
  var llmApiKey = document.getElementById('llm_api_key');
  var llmModel = document.getElementById('llm_model');
  var llmPrompt = document.getElementById('llm_prompt');
  var llmPromptReset = document.getElementById('llm_prompt_reset');
  var llmProtocolHint = document.getElementById('llm_protocol_hint');
  var llmProtocolBtns = document.querySelectorAll('#llm_protocol_btns .llm-protocol-btn');

  // 优先由浏览器根据内容排版高度；旧版 Chromium 才手动测量。
  var promptSizesToContent = CSS.supports('field-sizing', 'content');
  function resizeLlmPrompt() {
    if (promptSizesToContent) {
      llmPrompt.style.removeProperty('height');
      return;
    }
    if (!llmPrompt.getClientRects().length) return;
    llmPrompt.style.height = 'auto';
    var borderHeight = llmPrompt.offsetHeight - llmPrompt.clientHeight;
    llmPrompt.style.height = Math.ceil(llmPrompt.scrollHeight + borderHeight + 2) + 'px';
    llmPrompt.scrollTop = 0;
  }

  llmPrompt.addEventListener('input', resizeLlmPrompt);
  window.addEventListener('resize', resizeLlmPrompt);
  // 页面出现滚动条后可用宽度可能变化，换行后需重新测量高度。
  var promptWidth = 0;
  var promptResizeObserver = new ResizeObserver(function (entries) {
    var width = entries[0].contentRect.width;
    if (width > 0 && width !== promptWidth) {
      promptWidth = width;
      resizeLlmPrompt();
    }
  });
  promptResizeObserver.observe(llmPrompt);

  // ---- 状态 ----
  var editingId = null;      // null = 添加模式，否则为自定义源 id
  var editingType = null;    // 编辑模式记录原始 type（generic 编辑用）
  var activeType = null;     // 'alibaba' | 'baidu' | 'llm' | 'generic'
  var llmProtocol = 'openai'; // 'openai' | 'anthropic'
  var addableTypes = [];     // 传统类型元数据（后台 getAddableVendorTypes 返回）
  var loadToken = 0;         // 弹窗数据加载令牌：切换弹窗后丢弃过期回调，避免串表单

  // ---- 分类展开/收起 ----
  function setCategoryOpen(which, open) {
    var options = which === 'trad' ? traditionalOptions : llmOptions;
    options.style.display = open ? 'block' : 'none';
    var header = which === 'trad' ? tradHeader : llmHeader;
    var arrow = header.querySelector('.vendor-type-arrow');
    if (arrow) arrow.classList.toggle('open', open);
    header.setAttribute('aria-expanded', String(open));
    // 「展示名称」与 LLM 配置字段（llm_fields）都不在 llm_options 内，收起分类时需一并隐藏；
    // 重新展开时仅当已选中大模型类型才恢复显示（未选类型前只展示协议按钮；
    // 传统类型选中状态下名称字段归属传统分类，不做处理）
    if (which === 'llm' && activeType === 'llm') {
      modalNameField.style.display = open ? 'block' : 'none';
      llmFields.style.display = open ? 'block' : 'none';
      if (open) resizeLlmPrompt();
    }
  }

  function collapseAllCategories() {
    setCategoryOpen('trad', false);
    setCategoryOpen('llm', false);
  }

  function hideAllFields() {
    modalNameField.style.display = 'none';
    credentialFields.style.display = 'none';
    credentialFields.innerHTML = '';
    llmFields.style.display = 'none';
  }

  tradHeader.addEventListener('click', function () {
    var open = traditionalOptions.style.display !== 'block';
    setCategoryOpen('trad', open);
  });

  llmHeader.addEventListener('click', function () {
    var open = llmOptions.style.display !== 'block';
    setCategoryOpen('llm', open);
  });

  // ---- 传统类型选择 ----
  typeRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (!this.checked) return;
      var typeDef = addableTypes.find(function (t) { return t.id === this.value; }, this);
      if (!typeDef) return;
      activeType = typeDef.id;
      editingType = null; // 传统类型添加路径不关心原 type
      llmFields.style.display = 'none';
      setCategoryOpen('llm', false);
      setCategoryOpen('trad', true);
      modalNameField.style.display = 'block';
      modalName.placeholder = typeDef.name;
      if (!editingId) modalName.value = typeDef.name;
      renderTradCredentialFields(typeDef);
      setActiveProtocolBtn(llmProtocol);
    });
  });

  function renderTradCredentialFields(typeDef) {
    traditionalOptions.appendChild(modalNameField);
    traditionalOptions.appendChild(credentialFields);
    credentialFields.style.display = 'block';
    credentialFields.innerHTML = '';
    credentialFields.dataset.vendorType = typeDef.id;

    typeDef.configFields.forEach(function (field) {
      var fieldGroup = document.createElement('div');
      fieldGroup.className = 'vendor-modal-field';

      var label = document.createElement('label');
      label.textContent = field.label;
      if (field.required) {
        var req = document.createElement('span');
        req.style.cssText = 'color:#c62828;font-weight:bold;';
        req.textContent = ' *';
        label.appendChild(req);
      }
      fieldGroup.appendChild(label);

      var input = document.createElement('input');
      input.type = field.type || 'text';
      input.placeholder = field.placeholder || '';
      input.dataset.fieldKey = field.key;
      input.required = field.required;
      input.className = 'vendor-credential-input';
      fieldGroup.appendChild(input);

      credentialFields.appendChild(fieldGroup);
    });

    if (typeDef.id === 'alibaba' || typeDef.id === 'baidu') {
      var help = document.createElement('div');
      help.className = 'vendor-modal-hint';
      var link = document.createElement('a');
      link.href = typeDef.id === 'alibaba'
        ? 'https://ram.console.aliyun.com/profile/access-keys'
        : 'https://fanyi-api.baidu.com/manage/apiKey';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = typeDef.id === 'alibaba'
        ? '获取 AccessKey：阿里云 AccessKey 管理'
        : '官方获取入口：百度翻译 APP ID 与 API Key';
      help.appendChild(link);
      credentialFields.appendChild(help);
    }

    var firstInput = credentialFields.querySelector('input');
    if (firstInput) firstInput.focus();
  }

  // ---- 大模型翻译选择（协议按钮切换） ----
  function setActiveProtocolBtn(protocol) {
    llmProtocolBtns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.protocol === protocol);
    });
  }

  function applyProtocolDefaults() {
    var d = LLM_DEFAULTS[llmProtocol];
    llmUrl.placeholder = d.url;
    llmModel.placeholder = d.model;

    llmUrlHint.textContent = 'Base URL 示例：' + d.url + '。也支持直接粘贴带 /chat/completions 或 /v1/messages 的完整接口地址。';
    if (llmProtocolHint) llmProtocolHint.textContent = LLM_PROTOCOL_LABELS[llmProtocol];
  }

  function selectLlm(protocol) {
    var wasLlm = activeType === 'llm';
    activeType = 'llm';
    editingType = null;
    llmProtocol = protocol === 'anthropic' ? 'anthropic' : 'openai';
    setActiveProtocolBtn(llmProtocol);

    // 清空传统选择
    typeRadios.forEach(function (r) { r.checked = false; });
    credentialFields.style.display = 'none';
    credentialFields.innerHTML = '';
    setCategoryOpen('trad', false);
    setCategoryOpen('llm', true);

    // 名称与 LLM 字段
    llmOptions.appendChild(modalNameField);
    llmOptions.appendChild(llmFields);
    modalNameField.style.display = 'block';
    modalName.placeholder = LLM_PROTOCOL_LABELS[llmProtocol];
    llmFields.style.display = 'block';
    // 首次进入大模型（非编辑、且此前不是大模型）时才重置名称与提示词
    if (!editingId && !wasLlm) {
      modalName.value = '';
      llmPrompt.value = DEFAULT_LLM_PROMPT;
    }
    applyProtocolDefaults();
    resizeLlmPrompt();
  }

  llmProtocolBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectLlm(btn.dataset.protocol);
    });
  });

  // 恢复默认提示词
  if (llmPromptReset) {
    llmPromptReset.addEventListener('click', function () {
      llmPrompt.value = DEFAULT_LLM_PROMPT;
      resizeLlmPrompt();
      llmPrompt.focus();
    });
  }

  // ---- 打开弹窗 ----
  function openAddModal() {
    editingId = null;
    editingType = null;
    activeType = null;
    llmProtocol = 'openai';
    loadToken++; // 使任何在途的“编辑加载”回调失效
    modalTitle.textContent = '添加翻译源';

    hideAllFields();
    collapseAllCategories();
    modalName.value = '';
    typeRadios.forEach(function (r) { r.checked = false; });
    // 添加模式下初始不预设选中态：OpenAI/Anthropic 两个按钮均为未选中样式
    // （与 Anthropic 按钮背景一致），待用户点击后才高亮，
    // 避免 "看似已选中" 与实际点击选中后视觉相同造成误导。
    llmProtocolBtns.forEach(function (b) { b.classList.remove('active'); });

    // 示例仅作为占位提示，不作为实际填写内容。
    llmUrl.value = '';
    llmUrl.placeholder = LLM_DEFAULTS.openai.url;
    llmModel.value = '';
    llmModel.placeholder = LLM_DEFAULTS.openai.model;
    llmApiKey.value = '';
    llmPrompt.value = DEFAULT_LLM_PROMPT;
    if (llmProtocolHint) llmProtocolHint.textContent = LLM_PROTOCOL_LABELS.openai;
    llmUrlHint.textContent = 'Base URL 示例：' + LLM_DEFAULTS.openai.url + '。也支持直接粘贴带 /chat/completions 或 /v1/messages 的完整接口地址。';

    // 拉取传统类型元数据（渲染凭据字段用）
    chrome.runtime.sendMessage({ action: 'getAddableVendorTypes' }, function (resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok && resp.types) {
        addableTypes = resp.types;
      }
    });

    openModal();
  }

  function openEditModal(vendorId) {
    var vendor = vendors.find(function (v) { return v.id === vendorId; });
    if (!vendor) return;
    editingId = vendorId;
    var token = ++loadToken;
    modalTitle.textContent = '编辑翻译源';

    hideAllFields();
    collapseAllCategories();
    modalName.value = '';

    typeRadios.forEach(function (r) { r.checked = false; });
    if (vendor.isBuiltin) {
      activeType = 'builtin';
      modal.querySelector('.vendor-type-selector').style.display = 'none';
      modal.querySelector('.vendor-modal-body').appendChild(modalNameField);
      modal.querySelector('.vendor-modal-body').appendChild(credentialFields);
      modalNameField.style.display = 'block';
      modalName.value = vendor.name;
      openModal();
      return;
    }

    // 拉取类型元数据后加载完整记录（回调可能晚到：若期间已切换弹窗则丢弃）
    chrome.runtime.sendMessage({ action: 'getAddableVendorTypes' }, function (typeResp) {
      if (typeResp && typeResp.ok && typeResp.types) {
        addableTypes = typeResp.types;
      }
      chrome.runtime.sendMessage({ action: 'getCustomVendors' }, function (resp) {
        if (token !== loadToken) return; // 弹窗已被切换/关闭，丢弃过期数据
        if (chrome.runtime.lastError) return;
        if (resp && resp.ok && resp.vendors) {
          var full = resp.vendors.find(function (v) { return v.id === vendorId; });
          if (full && editingId === vendorId) fillEditForm(full);
        }
      });
    });

    openModal();
  }

  // 打开/关闭弹窗：通过 body.modal-open 让弹窗进入文档流，
  // popup 窗口随弹窗内容自适应宽高（见 css/popup.css）
  function openModal() {
    document.body.classList.add('modal-open');
    resizeLlmPrompt();
    modalClose.focus();
  }

  function fillEditForm(full) {
    modalNameField.style.display = 'block';
    modalName.value = full.name || '';

    // 大模型翻译源
    if (full.type === 'llm') {
      var protocol = full.protocol === 'anthropic' ? 'anthropic' : 'openai';
      selectLlm(protocol);
      // 仅回填实际保存的配置，缺失字段保持为空。
      llmUrl.value = full.url || '';
      llmApiKey.value = full.apiKey || '';
      llmModel.value = full.model || '';
      llmPrompt.value = (full.prompt && full.prompt.trim()) ? full.prompt : DEFAULT_LLM_PROMPT;
      resizeLlmPrompt();
      applyProtocolDefaults();
      // 历史版本保存不全的记录：提示补全后保存一次以修复
      if (!full.apiKey || !full.url || !full.model) {
        llmUrlHint.textContent = '该翻译源配置不完整，请补全 API 接口地址、API Key 和模型名称后保存。输入框中的示例仅为提示。';
      }
      return;
    }

    // 已知传统类型（alibaba / baidu）
    if (full.type && addableTypes.some(function (t) { return t.id === full.type; })) {
      var typeDef = addableTypes.find(function (t) { return t.id === full.type; });
      activeType = typeDef.id;
      editingType = null;
      setCategoryOpen('trad', true);
      setCategoryOpen('llm', false);
      modalName.placeholder = typeDef.name;
      // 选中对应 radio
      typeRadios.forEach(function (r) { r.checked = r.value === full.type; });
      renderTradCredentialFields(typeDef);
      // 回填已有凭据
      typeDef.configFields.forEach(function (field) {
        var input = credentialFields.querySelector('input[data-field-key="' + field.key + '"]');
        if (input && full[field.key] !== undefined && full[field.key] !== null) {
          input.value = full[field.key];
        }
      });
      return;
    }

    // 兜底：无类型的历史自定义源（url/appId/appKey）
    activeType = 'generic';
    modal.querySelector('.vendor-modal-body').appendChild(modalNameField);
    modal.querySelector('.vendor-modal-body').appendChild(credentialFields);
    editingType = full.type || '';
    modalName.placeholder = '如：我的翻译服务';
    credentialFields.style.display = 'block';
    credentialFields.innerHTML = '';
    credentialFields.dataset.vendorType = 'generic';

    [["url", "URL", full.url, "text", false], ["appId", "APP ID", full.appId, "text", false], ["appKey", "API Key", full.appKey, "password", false]].forEach(function (f) {
      var fieldGroup = document.createElement('div');
      fieldGroup.className = 'vendor-modal-field';
      var label = document.createElement('label');
      label.textContent = f[1];
      fieldGroup.appendChild(label);
      var input = document.createElement('input');
      input.type = f[3];
      input.value = f[2] || '';
      input.className = 'vendor-credential-input';
      input.dataset.fieldKey = f[0];
      fieldGroup.appendChild(input);
      credentialFields.appendChild(fieldGroup);
    });
  }

  function closeModal() {
    modal.querySelector('.vendor-type-selector').style.display = '';
    document.body.classList.remove('modal-open');
    addBtn.focus();
    editingId = null;
    editingType = null;
    activeType = null;
    loadToken++; // 丢弃在途的编辑加载回调
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.classList.contains('modal-open')) {
      e.preventDefault();
      closeModal();
    }
  });
  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  function getCredentialValues() {
    var values = {};
    credentialFields.querySelectorAll('.vendor-credential-input').forEach(function (input) {
      values[input.dataset.fieldKey] = input.value.trim();
    });
    return values;
  }

  modalSave.addEventListener('click', function () {
    if (!activeType) { alert('请先选择翻译源类型'); return; }

    var name = modalName.value.trim();
    if (!name) { alert('请输入展示名称'); modalName.focus(); return; }

    var payload;
    if (activeType === 'builtin') {
      payload = { name: name };
    } else if (activeType === 'llm') {
      var url = llmUrl.value.trim();
      var apiKey = llmApiKey.value.trim();
      var model = llmModel.value.trim();
      if (!url) { alert('请填写 API 接口地址'); llmUrl.focus(); return; }
      if (!/^https?:\/\//i.test(url)) { alert('接口地址需以 http(s):// 开头'); llmUrl.focus(); return; }
      if (!apiKey) { alert('请填写 API Key'); llmApiKey.focus(); return; }
      if (!model) { alert('请填写模型名称'); llmModel.focus(); return; }

      payload = {
        name: name,
        type: 'llm',
        protocol: llmProtocol,
        url: url,
        apiKey: apiKey,
        model: model,
        prompt: llmPrompt.value.trim(),
      };
    } else if (activeType === 'generic') {
      var credsG = getCredentialValues();
      payload = {
        name: name,
        type: editingType || '',
        url: credsG['url'] || '',
        appId: credsG['appId'] || '',
        appKey: credsG['appKey'] || '',
      };
    } else {
      // 传统类型 alibaba / baidu
      var creds = getCredentialValues();
      var typeDef = addableTypes.find(function (t) { return t.id === activeType; });
      if (typeDef) {
        for (var fi = 0; fi < typeDef.configFields.length; fi++) {
          var field = typeDef.configFields[fi];
          if (field.required && !creds[field.key]) {
            alert('请填写 ' + field.label);
            var input = credentialFields.querySelector('input[data-field-key="' + field.key + '"]');
            if (input) input.focus();
            return;
          }
        }
      }
      payload = {
        name: name,
        type: activeType,
        url: creds['url'] || '',  // 已知类型留空 → 后台按 defaultUrl 填充
        appId: creds['appId'] || '',
        appKey: creds['appKey'] || '',
      };
    }

    if (editingId) {
      chrome.runtime.sendMessage(Object.assign({ action: 'updateCustomVendor', id: editingId }, payload), function (resp) {
        if (chrome.runtime.lastError) { alert('保存失败'); return; }
        if (!resp || !resp.ok || !resp.updated) { alert('保存失败'); return; }
        closeModal();
        refreshVendorList();
      });
    } else {
      chrome.runtime.sendMessage(Object.assign({ action: 'addCustomVendor' }, payload), function (resp) {
        if (chrome.runtime.lastError) { alert('添加失败'); return; }
        if (resp && resp.ok && resp.vendor) {
          closeModal();
          refreshVendorList();
        } else {
          alert('添加失败');
        }
      });
    }
  });

  function deleteCustomVendorById(vendorId) {
    chrome.runtime.sendMessage({
      action: 'deleteCustomVendor',
      id: vendorId,
    }, function (resp) {
      if (chrome.runtime.lastError) { alert('删除失败'); return; }
      if (resp && resp.ok) {
        refreshVendorList();
      }
    });
  }
}
