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
// Global state to track active panel and messages
let activePanelState = {
  isVisible : false,
  messages  : [],
  timeoutId : null,
  type      : null
};

function showCautionPanel(message, seconds, errorOrWarning) {
  let cautionPanel = document.getElementById('cautionpanel');

  // Check if panel is already visible
  if (activePanelState.isVisible) {
    // If same type, merge messages
    if (activePanelState.type === errorOrWarning) {
      activePanelState.messages.push(message);

      // Clear existing timeout
      if (activePanelState.timeoutId) {
        clearTimeout(activePanelState.timeoutId);
      }

      // Update display with merged messages
      updatePanelDisplay(cautionPanel, activePanelState.messages, errorOrWarning);

      // Set new timeout
      if (seconds !== undefined && seconds > 0) {
        activePanelState.timeoutId = setTimeout(() => {
          hidePanel(cautionPanel);
        }, seconds * 1000);
      }

      return;
    } else {
      hidePanel(cautionPanel, 0);
    }
  }

  // Start fresh panel
  activePanelState.isVisible = true;
  activePanelState.messages = [message];
  activePanelState.type = errorOrWarning;

  // Remove all existing classes
  cautionPanel.classList.remove(
    'cautionpanel-error',
    'cautionpanel-warning',
    'cautionpanel-success',
    'cautionpanel-info'
  );

  // Add appropriate class based on type
  if (errorOrWarning === 'error') {
    cautionPanel.classList.add('cautionpanel-error');
  } else if (errorOrWarning === 'warning') {
    cautionPanel.classList.add('cautionpanel-warning');
  } else if (errorOrWarning === 'success') {
    cautionPanel.classList.add('cautionpanel-success');
  } else if (errorOrWarning === 'info') {
    cautionPanel.classList.add('cautionpanel-info');
  }

  // Update display
  updatePanelDisplay(cautionPanel, activePanelState.messages, errorOrWarning);

  // Set timeout
  if (seconds !== undefined && seconds > 0) {
    activePanelState.timeoutId = setTimeout(() => {
      hidePanel(cautionPanel);
    }, seconds * 1000);
  }
}

function updatePanelDisplay(cautionPanel, messages, errorOrWarning) {
  // Set appropriate icon and title based on type
  let icon, title;
  if (errorOrWarning === 'error') {
    icon = '⚠️';
    title = i18n.t('popups.error');
  } else if (errorOrWarning === 'warning') {
    icon = '⚠️';
    title = i18n.t('popups.warning');
  } else if (errorOrWarning === 'success') {
    icon = '✅';
    title = i18n.t('popups.success');
  } else if (errorOrWarning === 'info') {
    icon = 'ℹ️';
    title = i18n.t('popups.info');
  }

  cautionPanel.style.display = 'block';

  // Create structured HTML with header and content
  let html = `
    <div class="cautionpanel-header">
      <div style="display: flex; align-items: center;">
        <div class="cautionpanel-icon">${icon}</div>
        <div class="cautionpanel-title">${title}</div>
      </div>
      <div class="caution-close-btn" onclick="closeCautionPanel()">×</div>
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
  cautionPanel.innerHTML = html;
}

function hidePanel(cautionPanel, timeout = 300) {
  // Add exit animation class
  cautionPanel.classList.add('hiding');

  const hide = () => {
    cautionPanel.style.display = 'none';
    cautionPanel.classList.remove('hiding');
    activePanelState.isVisible = false;
    activePanelState.messages = [];
    activePanelState.type = null;
    if (activePanelState.timeoutId) {
      clearTimeout(activePanelState.timeoutId);
      activePanelState.timeoutId = null;
    }
  };

  // Wait for animation to complete before hiding
  if (timeout > 0) {
    setTimeout(hide, timeout);
  } else {
    hide();
  }
}

// Global function to close caution panel (accessible from onclick)
window.closeCautionPanel = function () {
  const cautionPanel = document.getElementById('cautionpanel');
  if (cautionPanel) {
    hidePanel(cautionPanel);
  }
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
