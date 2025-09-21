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

import { node } from '../utils/utils.js';
import { i18n } from '../i18n/i18n.js';

class WindowManager {

  constructor() {
    this.windows = new Map();
    this.settings = new Map();
    this.top = undefined;
    this.panelPositions = new Map(); // Store panel positions for restoration

    document.addEventListener('keydown', (event) => this.onKeyDown(event));

    // Listen for window resize events to recalculate viewport boundaries
    window.addEventListener('resize', () => this.handleWindowResize());

    // Listen for viewport resize events (triggered by sidebar changes)
    document.addEventListener('viewport-resized', () => this.handleSidebarStateChange());

  }

  onKeyDown(event) {
    if (event.key === 'w' && event.ctrlKey && this.top) {
      event.preventDefault();
      this.close(this.top.id);
    }
  }

  /**
   * Get the available viewport boundaries for floating panels
   * @returns {Object} Object containing min/max coordinates and available dimensions
   */
  getViewportBoundaries() {
    const navbarHeight = 48; // Height of the top navbar
    const footerHeight = 30; // Height of the footer
    const sidebarWidth = this.getSidebarWidth();
    const sidebarPosition = this.getSidebarPosition();

    const viewport = document.getElementById('viewport');
    const viewportRect = viewport.getBoundingClientRect();

    return {
      minTop          : navbarHeight,
      maxTop          : window.innerHeight - footerHeight,
      minLeft         : sidebarPosition === 'left' ? sidebarWidth : 0,
      maxLeft         : sidebarPosition === 'right' ? window.innerWidth - sidebarWidth : window.innerWidth,
      availableWidth  : sidebarPosition === 'left' ? window.innerWidth - sidebarWidth : window.innerWidth - sidebarWidth,
      availableHeight : window.innerHeight - navbarHeight - footerHeight,
      viewportRect    : viewportRect
    };
  }

  /**
   * Get the current sidebar width
   * @returns {number} Sidebar width in pixels
   */
  getSidebarWidth() {
    const sidebarContainer = document.getElementById('sidebar-container');
    if (!sidebarContainer) return 0;

    const computedStyle = window.getComputedStyle(sidebarContainer);
    return sidebarContainer.classList.contains('collapsed')
      ? parseInt(computedStyle.getPropertyValue('--sidebar-collapsed-width')) || 40
      : parseInt(computedStyle.getPropertyValue('--sidebar-width')) || 350;
  }

  /**
   * Get the current sidebar position (left or right)
   * @returns {string} 'left' or 'right'
   */
  getSidebarPosition() {
    const sidebarContainer = document.getElementById('sidebar-container');
    if (!sidebarContainer) return 'right';

    return sidebarContainer.classList.contains('left') ? 'left' : 'right';
  }

  /**
   * Calculate optimal position for a panel to stay within viewport boundaries
   * @param {HTMLElement} panel - The panel element
   * @param {number} preferredX - Preferred X position
   * @param {number} preferredY - Preferred Y position
   * @returns {Object} Object containing adjusted x, y coordinates
   */
  calculateOptimalPosition(panel, preferredX = null, preferredY = null) {
    const boundaries = this.getViewportBoundaries();
    const panelRect = panel.getBoundingClientRect();

    // Default to center of viewport if no preferred position
    const defaultX = boundaries.minLeft + (boundaries.availableWidth - panelRect.width) / 2;
    const defaultY = boundaries.minTop + (boundaries.availableHeight - panelRect.height) / 2;

    let x = preferredX !== null ? preferredX : defaultX;
    let y = preferredY !== null ? preferredY : defaultY;

    // Ensure panel stays within horizontal boundaries
    x = Math.max(boundaries.minLeft, Math.min(x, boundaries.maxLeft - panelRect.width));

    // Ensure panel stays within vertical boundaries
    y = Math.max(boundaries.minTop, Math.min(y, boundaries.maxTop - panelRect.height));

    return { x, y };
  }

  /**
   * Constrain panel size to fit within viewport
   * @param {HTMLElement} panel - The panel element
   * @param {number} preferredWidth - Preferred width
   * @param {number} preferredHeight - Preferred height
   * @returns {Object} Object containing constrained width and height
   */
  constrainPanelSize(panel, preferredWidth, preferredHeight) {
    const boundaries = this.getViewportBoundaries();
    const minWidth = 300; // Minimum panel width
    const minHeight = 250; // Minimum panel height

    // Calculate maximum available dimensions
    const maxWidth = Math.max(minWidth, boundaries.availableWidth - 20); // 20px margin
    const maxHeight = Math.max(minHeight, boundaries.availableHeight - 20); // 20px margin

    const width = Math.max(minWidth, Math.min(preferredWidth, maxWidth));
    const height = Math.max(minHeight, Math.min(preferredHeight, maxHeight));

    return { width, height };
  }

  /**
   * Handle window resize events
   */
  handleWindowResize() {
    // Reposition and resize all open windows to ensure they stay within viewport
    console.log('handleWindowResize');
    this.windows.forEach((windowData) => {
      const panel = windowData.window;
      const currentRect = panel.getBoundingClientRect();
      const boundaries = this.getViewportBoundaries();

      // Check if panel needs resizing (is larger than available space)
      const needsResize =
        currentRect.width > boundaries.availableWidth || currentRect.height > boundaries.availableHeight;

      if (needsResize) {
        // Constrain panel size to fit within new viewport
        const constrainedSize = this.constrainPanelSize(panel, currentRect.width, currentRect.height);
        panel.style.width = constrainedSize.width + 'px';
        panel.style.height = constrainedSize.height + 'px';

        // Update saved position with new size
        this.savePanelPosition(
          panel.id,
          currentRect.left,
          currentRect.top,
          constrainedSize.width,
          constrainedSize.height
        );
      }

      // Recalculate optimal position
      const optimalPos = this.calculateOptimalPosition(panel, currentRect.left, currentRect.top);

      // Only move if the panel is outside the new boundaries
      if (
        currentRect.left < boundaries.minLeft ||
        currentRect.right > boundaries.maxLeft ||
        currentRect.top < boundaries.minTop ||
        currentRect.bottom > boundaries.maxTop
      ) {

        panel.style.left = optimalPos.x + 'px';
        panel.style.top = optimalPos.y + 'px';

        // Update saved position with new coordinates
        this.savePanelPosition(panel.id, optimalPos.x, optimalPos.y, panel.offsetWidth, panel.offsetHeight);
      }
    });
  }

  /**
   * Handle sidebar state changes (collapsed/expanded, left/right position)
   */
  handleSidebarStateChange() {
    // Reposition and resize all open windows when sidebar state changes
    this.windows.forEach((windowData) => {
      const panel = windowData.window;
      const currentRect = panel.getBoundingClientRect();
      const boundaries = this.getViewportBoundaries();

      // Check if panel needs resizing (is larger than available space)
      const needsResize =
        currentRect.width > boundaries.availableWidth || currentRect.height > boundaries.availableHeight;

      if (needsResize) {
        // Constrain panel size to fit within new viewport
        const constrainedSize = this.constrainPanelSize(panel, currentRect.width, currentRect.height);
        panel.style.width = constrainedSize.width + 'px';
        panel.style.height = constrainedSize.height + 'px';

        // Update saved position with new size
        this.savePanelPosition(
          panel.id,
          currentRect.left,
          currentRect.top,
          constrainedSize.width,
          constrainedSize.height
        );
      }

      // Recalculate optimal position based on new sidebar state
      const optimalPos = this.calculateOptimalPosition(panel, currentRect.left, currentRect.top);

      panel.style.left = optimalPos.x + 'px';
      panel.style.top = optimalPos.y + 'px';

      // Update saved position with new coordinates
      this.savePanelPosition(panel.id, optimalPos.x, optimalPos.y, panel.offsetWidth, panel.offsetHeight);
    });
  }

  /**
   * Save panel position for future restoration
   * @param {string} panelId - The panel ID
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} width - Panel width
   * @param {number} height - Panel height
   */
  savePanelPosition(panelId, x, y, width, height) {
    this.panelPositions.set(panelId, {
      x         : x,
      y         : y,
      width     : width,
      height    : height,
      timestamp : Date.now()
    });
  }

  /**
   * Get saved panel position
   * @param {string} panelId - The panel ID
   * @returns {Object|null} Saved position data or null if not found
   */
  getSavedPanelPosition(panelId) {
    return this.panelPositions.get(panelId) || null;
  }

  /**
   * Remove saved panel position
   * @param {string} panelId - The panel ID
   */
  removeSavedPanelPosition(panelId) {
    this.panelPositions.delete(panelId);
  }

  close(id) {
    const item = this.windows.get(id);
    const panel = item.window;

    // Save panel position before closing
    const rect = panel.getBoundingClientRect();
    this.savePanelPosition(id, rect.left, rect.top, rect.width, rect.height);

    panel.style.display = 'none';
    const content = panel.querySelector('.popup-content-div');
    item.close(content);
    panel.removeEventListener('click', item.click);
    content.remove();
    this.windows.delete(panel.id);
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

    const elementDrag = (e) => {
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

      // Use the new boundary detection system
      const boundaries = this.getViewportBoundaries();
      newTop = Math.max(boundaries.minTop, Math.min(newTop, boundaries.maxTop - s.elmnt.offsetHeight));
      newLeft = Math.max(boundaries.minLeft, Math.min(newLeft, boundaries.maxLeft - s.elmnt.offsetWidth));

      s.elmnt.style.top = newTop + 'px';
      s.elmnt.style.left = newLeft + 'px';

      // Save position in real-time during drag
      this.savePanelPosition(s.elmnt.id, newLeft, newTop, s.elmnt.offsetWidth, s.elmnt.offsetHeight);
    };

    function initDrag(e) {
      s.elmnt = this.parentPopup;

      // Prevent resize if panel is minimized
      if (s.isMinimized) {
        return;
      }

      s.startX = e.clientX;
      s.startY = e.clientY;
      s.startWidth = parseInt(document.defaultView.getComputedStyle(s.elmnt).width, 10);
      s.startHeight = parseInt(document.defaultView.getComputedStyle(s.elmnt).height, 10);
      document.documentElement.addEventListener('mousemove', doDrag, false);
      document.documentElement.addEventListener('mouseup', stopDrag, false);
    }

    const doDrag = (e) => {
      // Prevent resize if panel is minimized
      if (s.isMinimized) {
        return;
      }

      s.pHeight = s.startHeight + e.clientY - s.startY;
      s.pWidth = s.startWidth + e.clientX - s.startX;

      // Constrain size to viewport boundaries
      const constrainedSize = this.constrainPanelSize(s.elmnt, s.pWidth, s.pHeight);
      s.pWidth = constrainedSize.width;
      s.pHeight = constrainedSize.height;

      s.elmnt.style.width = s.pWidth + 'px';
      s.elmnt.style.height = s.pHeight + 'px';
      doDragFn(s.pWidth, s.pHeight);

      // Save position and size during resize
      this.savePanelPosition(s.elmnt.id, s.elmnt.offsetLeft, s.elmnt.offsetTop, s.pWidth, s.pHeight);

    };

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
      const resizers = s.elmnt.querySelectorAll('.resizer-right, .resizer-bottom, .resizer-both');

      if (!s.isMinimized) {
        // Store original height and content elements
        if (s.originalHeight === null) {
          s.originalHeight = s.elmnt.offsetHeight;
          s.originalMinHeight = s.elmnt.style.minHeight;
        }
        contentElement.style.display = 'none';

        // Hide resize handles when minimized
        resizers.forEach((resizer) => {
          resizer.style.display = 'none';
        });

        // Set height to just the header height
        const headerHeight = s.elmnt.querySelector('.popup-header').offsetHeight;
        s.elmnt.style.minHeight = headerHeight + 'px';
        s.elmnt.style.height = headerHeight + 'px';
        s.isMinimized = true;
        minimizeBtn.classList.add('minimized');
      } else {
        // Restore content elements and original height
        contentElement.style.display = 'block';

        // Show resize handles when maximized
        resizers.forEach((resizer) => {
          resizer.style.display = '';
        });

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
      // Constrain initial size to viewport boundaries
      const constrainedSize = this.constrainPanelSize(panel, options.width, options.height);
      panel.style.width = constrainedSize.width + 'px';
      panel.style.height = constrainedSize.height + 'px';

      // Update options with constrained values
      options.width = constrainedSize.width;
      options.height = constrainedSize.height;
    }

    buildFn(content, () => this.close(panel.id));
    panel.style.display = 'block';

    // Try to restore previous position, otherwise center the panel
    const savedPosition = this.getSavedPanelPosition(panel.id);
    let optimalPos;

    if (savedPosition) {
      // Restore previous position, but ensure it's still within current viewport boundaries
      optimalPos = this.calculateOptimalPosition(panel, savedPosition.x, savedPosition.y);

      // Also restore size if it was saved
      if (savedPosition.width && savedPosition.height) {
        const constrainedSize = this.constrainPanelSize(panel, savedPosition.width, savedPosition.height);
        panel.style.width = constrainedSize.width + 'px';
        panel.style.height = constrainedSize.height + 'px';

        // Update options if they exist
        if (options?.width && options?.height) {
          options.width = constrainedSize.width;
          options.height = constrainedSize.height;
        }
      }
    } else {
      // First time opening this panel - center it
      optimalPos = this.calculateOptimalPosition(panel);
    }

    panel.style.left = optimalPos.x + 'px';
    panel.style.top = optimalPos.y + 'px';

    // Save the initial position
    this.savePanelPosition(panel.id, optimalPos.x, optimalPos.y, panel.offsetWidth, panel.offsetHeight);

  }
}

const wm = new WindowManager();

export { wm, WindowManager };
