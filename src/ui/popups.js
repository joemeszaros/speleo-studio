/*
 * Copyright 2024 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { i18n } from '../i18n/i18n.js';

// `#cautionpanel` is a fixed container that stacks one notification *item* per message type
// (error / warning / info / success). Keeping the types separate means an info or success
// message no longer wipes a still-visible error — they are shown together (stacked). Each type
// keeps its own merged message list and auto-dismiss timeout.
const panelStates = new Map(); // type -> { messages: string[], timeoutId: number | null }

const PANEL_META = {
  error   : { icon: '⚠️', titleKey: 'popups.error' },
  warning : { icon: '⚠️', titleKey: 'popups.warning' },
  success : { icon: '✅', titleKey: 'popups.success' },
  info    : { icon: 'ℹ️', titleKey: 'popups.info' }
};

function showCautionPanel(message, seconds, type) {
  const container = document.getElementById('cautionpanel');
  if (!container) return;
  container.style.display = 'flex';

  let state = panelStates.get(type);
  if (!state) {
    state = { messages: [], timeoutId: null };
    panelStates.set(type, state);
  }
  state.messages.push(message);
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }

  const item = ensureItem(container, type);
  item.innerHTML = itemContent(type, state.messages);

  if (seconds !== undefined && seconds > 0) {
    state.timeoutId = setTimeout(() => closeType(type), seconds * 1000);
  }
}

// Returns the existing item element for a type, or creates and appends a fresh one. New items
// animate in; existing ones are only updated in place (no re-entry animation on every message).
function ensureItem(container, type) {
  let item = container.querySelector(`.cautionpanel-item[data-type="${type}"]`);
  if (!item) {
    item = document.createElement('div');
    item.className = `cautionpanel-item cautionpanel-${type}`;
    item.dataset.type = type;
    container.appendChild(item);
  }
  return item;
}

function itemContent(type, messages) {
  const meta = PANEL_META[type] ?? PANEL_META.info;
  const icon = meta.icon;
  const title = i18n.t(meta.titleKey);

  let html = `
    <div class="cautionpanel-header">
      <div style="display: flex; align-items: center;">
        <div class="cautionpanel-icon">${icon}</div>
        <div class="cautionpanel-title">${title}</div>
      </div>
      <div class="caution-close-btn" onclick="closeCautionPanelType('${type}')">×</div>
    </div>
    <div class="cautionpanel-content">
  `;

  if (messages.length === 1) {
    html += `<div class="cautionpanel-message">${messages[0]}</div>`;
  } else {
    html += `<div class="cautionpanel-message">${messages.length} messages:</div>`;
    html += `<div class="cautionpanel-message-list">`;
    messages.forEach((msg) => {
      html += `
        <div class="message-item">
          <div class="message-bullet">•</div>
          <div>${msg}</div>
        </div>
      `;
    });
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// Closes a single type's item (with exit animation); hides the container once empty.
function closeType(type) {
  const state = panelStates.get(type);
  if (!state) return;
  if (state.timeoutId) clearTimeout(state.timeoutId);
  panelStates.delete(type);

  const container = document.getElementById('cautionpanel');
  const item = container?.querySelector(`.cautionpanel-item[data-type="${type}"]`);
  const finish = () => {
    if (item) item.remove();
    if (container && panelStates.size === 0) container.style.display = 'none';
  };
  if (item) {
    item.classList.add('hiding');
    setTimeout(finish, 300);
  } else {
    finish();
  }
}

// Global helpers (accessible from inline onclick and from tests):
//   closeCautionPanelType(type) — close one type's notification
//   closeCautionPanel()         — close all notifications
window.closeCautionPanelType = function (type) {
  closeType(type);
};

window.closeCautionPanel = function () {
  for (const type of [...panelStates.keys()]) closeType(type);
};

function showErrorPanel(message, seconds = 0) {
  showCautionPanel(message, seconds, 'error');
}

function showWarningPanel(message, seconds = 0) {
  showCautionPanel(message, seconds, 'warning');
}

function showSuccessPanel(message, seconds = 0) {
  showCautionPanel(message, seconds, 'success');
}

function showInfoPanel(message, seconds = 0) {
  showCautionPanel(message, seconds, 'info');
}

export { showErrorPanel, showWarningPanel, showSuccessPanel, showInfoPanel };
