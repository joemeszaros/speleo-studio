import { node } from '../utils/utils.js';
import { i18n } from '../i18n/i18n.js';

class WindowManager {

  constructor() {
    this.windows = new Map();
    this.settings = new Map();
    this.top = undefined;

    document.addEventListener('keydown', (event) => this.onKeyDown(event));

  }

  onKeyDown(event) {
    if (event.key === 'w' && event.ctrlKey && this.top) {
      event.preventDefault();
      this.close(this.top.id);
    }
  }

  close(id) {
    const item = this.windows.get(id);
    item.window.style.display = 'none';
    const content = item.window.querySelector('.popup-content-div');
    item.close(content);
    item.window.removeEventListener('click', item.click);
    content.remove();
    this.windows.delete(item.window.id);
    if (this.windows.size === 0) {
      this.top = undefined;
    }
    document.removeEventListener('languageChanged', item.langChange);
  }

  click(id) {
    if (this.top && id === this.top.id) {
      return;
    }
    this.moveToTop(id);

  }

  moveToTop(id) {
    let index = 0;
    const sortedByTime = [...this.windows.values().filter((item) => item.id !== id)].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    sortedByTime.forEach((item) => {
      item.window.style.zIndex = 100 + index;
      index++;
    });

    const item = this.windows.get(id);
    item.window.style.zIndex = 100 + index;
    this.top = item.window;
  }

  langChangeHandler = (panel, headerTextTransKeyOrFn, buildFn) => {
    const newcontent = node`<div class="popup-content-div"></div>`;
    const content = panel.querySelector('.popup-content-div');
    const header = panel.querySelector('.popup-header');
    const title =
      typeof headerTextTransKeyOrFn === 'function' ? headerTextTransKeyOrFn() : i18n.t(headerTextTransKeyOrFn);
    const text = document.createTextNode(title);
    //change title
    header.replaceChild(text, header.firstChild);
    panel.replaceChild(newcontent, content); //we need to replace first to let Tabulator find the right element
    buildFn(newcontent);
  };

  //https://codepen.io/jkasun/pen/QrLjXP
  makeFloatingPanel(
    panel,
    buildFn,
    headerTextTransKeyOrFn,
    resizable = true,
    minimizable = true,
    options = {},
    closeFn = () => {},
    doDragFn = () => {},
    stopDragFn = () => {}
  ) {

    // close previously opened window
    if (this.windows.has(panel.id)) {
      this.close(panel.id);
    }

    const langChangeHandler = () => this.langChangeHandler(panel, headerTextTransKeyOrFn, buildFn);
    document.addEventListener('languageChanged', langChangeHandler);

    // Create a bound event listener that can accept additional parameters
    const clickHandler = () => this.click(panel.id);

    this.windows.set(panel.id, {
      window     : panel,
      close      : closeFn,
      click      : clickHandler,
      langChange : langChangeHandler,
      timestamp  : Date.now()

    });
    this.moveToTop(panel.id);
    panel.addEventListener('click', clickHandler);

    let s;
    if (!this.settings.has(panel.id)) {
      s = {
        pos1              : 0,
        pos2              : 0,
        pos3              : 0,
        pos4              : 0,
        startX            : 0,
        startY            : 0,
        startWidth        : 0,
        startHeight       : 0,
        pWidth            : 0,
        pHeight           : 0,
        elmnt             : null,
        currentZIndex     : 100,
        isMinimized       : false,
        originalHeight    : null,
        originalMinHeight : null
      };
      this.settings.set(panel.id, s);
    } else {
      s = this.settings.get(panel.id);
    }

    function closeDragElement() {
      /* stop moving when mouse button is released:*/
      document.onmouseup = null;
      document.onmousemove = null;
    }

    function dragMouseDown(e) {
      s.elmnt = this.parentPopup;
      s.elmnt.style.zIndex = '' + ++s.currentZIndex;

      e = e || window.event;
      // get the mouse cursor position at startup:
      s.pos3 = e.clientX;
      s.pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      // call a function whenever the cursor moves:
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      if (!s.elmnt) {
        return;
      }

      e = e || window.event;
      // calculate the new cursor position:
      s.pos1 = s.pos3 - e.clientX;
      s.pos2 = s.pos4 - e.clientY;
      s.pos3 = e.clientX;
      s.pos4 = e.clientY;

      // Calculate new position
      let newTop = s.elmnt.offsetTop - s.pos2;
      let newLeft = s.elmnt.offsetLeft - s.pos1;

      // Clamp to viewport
      const minTop = 48; // navbar
      const minLeft = 0;
      const maxTop = window.innerHeight - s.elmnt.offsetHeight - 30; // 30 is the footer height
      const maxLeft = window.innerWidth - s.elmnt.offsetWidth - 30; // 30 is the footer width

      newTop = Math.max(minTop, Math.min(newTop, maxTop));
      newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));

      s.elmnt.style.top = newTop + 'px';
      s.elmnt.style.left = newLeft + 'px';
    }

    function initDrag(e) {
      s.elmnt = this.parentPopup;
      s.startX = e.clientX;
      s.startY = e.clientY;
      s.startWidth = parseInt(document.defaultView.getComputedStyle(s.elmnt).width, 10);
      s.startHeight = parseInt(document.defaultView.getComputedStyle(s.elmnt).height, 10);
      document.documentElement.addEventListener('mousemove', doDrag, false);
      document.documentElement.addEventListener('mouseup', stopDrag, false);
    }

    function doDrag(e) {
      s.pHeight = s.startHeight + e.clientY - s.startY;
      s.pWidth = s.startWidth + e.clientX - s.startX;
      s.elmnt.style.width = s.pWidth + 'px';
      s.elmnt.style.height = s.pHeight + 'px';
      doDragFn(s.pWidth, s.pHeight);

    }

    function stopDrag() {
      stopDragFn(s.pWidth, s.pHeight);
      if (options?.width && options?.height) {
        options.width = s.pWidth;
        options.height = s.pHeight;
      }
      document.documentElement.removeEventListener('mousemove', doDrag, false);
      document.documentElement.removeEventListener('mouseup', stopDrag, false);
    }

    function toggleMinimize(minimizeBtn) {

      const contentElement = s.elmnt.querySelector('.popup-content-div');

      if (!s.isMinimized) {
        // Store original height and content elements
        if (s.originalHeight === null) {
          s.originalHeight = s.elmnt.offsetHeight;
          s.originalMinHeight = s.elmnt.style.minHeight;
        }
        contentElement.style.display = 'none';

        // Set height to just the header height
        const headerHeight = s.elmnt.querySelector('.popup-header').offsetHeight;
        s.elmnt.style.minHeight = headerHeight + 'px';
        s.elmnt.style.height = headerHeight + 'px';
        s.isMinimized = true;
        minimizeBtn.classList.add('minimized');
      } else {
        // Restore content elements and original height
        contentElement.style.display = 'block';

        if (s.originalHeight !== null) {
          s.elmnt.style.height = s.originalHeight + 'px';
        }

        if (s.originalMinHeight !== null) {
          s.elmnt.style.minHeight = s.originalMinHeight;
        }

        s.originalHeight = null;
        s.originalMinHeight = null;

        s.isMinimized = false;
        minimizeBtn.classList.remove('minimized');
      }
    }

    const close = node`<div class="close"></div>`;
    close.onclick = () => this.close(panel.id);

    panel.innerHTML = '';

    const title =
      typeof headerTextTransKeyOrFn === 'function' ? headerTextTransKeyOrFn() : i18n.t(headerTextTransKeyOrFn);
    const header = node`<div class="popup-header">${title}</div>`;

    if (minimizable) {
      const minimizeBtn = node`<div class="minimize"></div>`;
      minimizeBtn.onclick = () => toggleMinimize(minimizeBtn);
      header.appendChild(minimizeBtn);
    }

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

    const content = node`<div class="popup-content-div"></div>`;
    panel.appendChild(content);

    if (options?.width && options?.height) {
      panel.style.width = options.width + 'px';
      panel.style.height = options.height + 'px';
    }

    buildFn(content, () => this.close(panel.id));
    panel.style.display = 'block';

  }
}

const wm = new WindowManager();

export { wm, WindowManager };
