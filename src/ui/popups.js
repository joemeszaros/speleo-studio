import { node } from '../utils/utils.js';

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
      // Different type - hide current panel and show new one
      hidePanel(cautionPanel);
    }
  }

  // Start fresh panel
  activePanelState.isVisible = true;
  activePanelState.messages = [message];
  activePanelState.type = errorOrWarning;

  // Remove all existing classes
  cautionPanel.classList.remove('cautionpanel-error', 'cautionpanel-warning', 'cautionpanel-success');

  // Add appropriate class based on type
  if (errorOrWarning === 'error') {
    cautionPanel.classList.add('cautionpanel-error');
  } else if (errorOrWarning === 'warning') {
    cautionPanel.classList.add('cautionpanel-warning');
  } else if (errorOrWarning === 'success') {
    cautionPanel.classList.add('cautionpanel-success');
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
  // Set appropriate icon and color based on type
  let icon, color;
  if (errorOrWarning === 'error') {
    icon = '⚠';
    color = '#8a1a12';
  } else if (errorOrWarning === 'warning') {
    icon = '⚠';
    color = '#8a1a12';
  } else if (errorOrWarning === 'success') {
    icon = '✅';
    color = '#1a8a12';
  }

  cautionPanel.style.display = 'block';

  // Add close button
  let messageContent = `<span class="caution-close-btn" onclick="closeCautionPanel()">×</span>`;

  // Create merged message content
  messageContent += `<strong style="color:${color}">${icon} ${errorOrWarning.toUpperCase()}</strong>`;

  if (messages.length === 1) {
    messageContent += ` ${messages[0]}`;
  } else {
    messageContent += ` (${messages.length} messages):<br>`;
    messages.forEach((msg, index) => {
      messageContent += `• ${msg}`;
      if (index < messages.length - 1) {
        messageContent += '<br>';
      }
    });
  }

  cautionPanel.innerHTML = messageContent;
}

function hidePanel(cautionPanel) {
  cautionPanel.style.display = 'none';
  activePanelState.isVisible = false;
  activePanelState.messages = [];
  activePanelState.type = null;
  if (activePanelState.timeoutId) {
    clearTimeout(activePanelState.timeoutId);
    activePanelState.timeoutId = null;
  }
}

// Global function to close caution panel (accessible from onclick)
window.closeCautionPanel = function () {
  const cautionPanel = document.getElementById('cautionpanel');
  if (cautionPanel) {
    hidePanel(cautionPanel);
  }
};

function showErrorPanel(message, seconds = 6) {
  showCautionPanel(message, seconds, 'error');
}

function showWarningPanel(message, seconds = 6) {
  showCautionPanel(message, seconds, 'warning');
}

function showSuccessPanel(message, seconds = 4) {
  showCautionPanel(message, seconds, 'success');
}

function makeMovable(panel, headerText, resizable = true, closeFn, doDragFn, stopDragFn) {

  //https://codepen.io/jkasun/pen/QrLjXP

  var pos1 = 0,
    pos2 = 0,
    pos3 = 0,
    pos4 = 0;
  var startX, startY, startWidth, startHeight;
  var pWidth, pHeight;

  var elmnt = null;
  var currentZIndex = 100;

  function closeDragElement() {
    /* stop moving when mouse button is released:*/
    document.onmouseup = null;
    document.onmousemove = null;
  }

  function dragMouseDown(e) {
    elmnt = this.parentPopup;
    elmnt.style.zIndex = '' + ++currentZIndex;

    e = e || window.event;
    // get the mouse cursor position at startup:
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // call a function whenever the cursor moves:
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    if (!elmnt) {
      return;
    }

    e = e || window.event;
    // calculate the new cursor position:
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;

    // Calculate new position
    let newTop = elmnt.offsetTop - pos2;
    let newLeft = elmnt.offsetLeft - pos1;

    // Clamp to viewport
    const minTop = 0;
    const minLeft = 0;
    const maxTop = window.innerHeight - elmnt.offsetHeight;
    const maxLeft = window.innerWidth - elmnt.offsetWidth;

    newTop = Math.max(minTop, Math.min(newTop, maxTop));
    newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));

    elmnt.style.top = newTop + 'px';
    elmnt.style.left = newLeft + 'px';
  }

  function initDrag(e) {
    elmnt = this.parentPopup;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = parseInt(document.defaultView.getComputedStyle(elmnt).width, 10);
    startHeight = parseInt(document.defaultView.getComputedStyle(elmnt).height, 10);
    document.documentElement.addEventListener('mousemove', doDrag, false);
    document.documentElement.addEventListener('mouseup', stopDrag, false);
  }

  const doDrag = (e) => {
    pHeight = startHeight + e.clientY - startY;
    pWidth = startWidth + e.clientX - startX;
    elmnt.style.width = pWidth + 'px';
    elmnt.style.height = pHeight + 'px';
    doDragFn(pWidth, pHeight);

  };

  const stopDrag = () => {
    stopDragFn(pWidth, pHeight);
    document.documentElement.removeEventListener('mousemove', doDrag, false);
    document.documentElement.removeEventListener('mouseup', stopDrag, false);
  };

  const close = node`<div class="close"></div>`;
  close.onclick = () => {
    closeFn();
  };

  const header = node`<div class="popup-header">${headerText}</div>`;
  header.appendChild(close);
  header.parentPopup = panel;
  header.onmousedown = dragMouseDown;
  panel.appendChild(header);

  if (resizable) {
    var right = document.createElement('div');
    right.className = 'resizer-right';
    panel.appendChild(right);
    right.addEventListener('mousedown', initDrag, false);
    right.parentPopup = panel;

    var bottom = document.createElement('div');
    bottom.className = 'resizer-bottom';
    panel.appendChild(bottom);
    bottom.addEventListener('mousedown', initDrag, false);
    bottom.parentPopup = panel;

    var both = document.createElement('div');
    both.className = 'resizer-both';
    panel.appendChild(both);
    both.addEventListener('mousedown', initDrag, false);
    both.parentPopup = panel;
  }
}

export { showErrorPanel, showWarningPanel, showSuccessPanel, makeMovable };
