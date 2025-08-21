export class Sidebar {
  constructor(config = null) {
    this.container = document.getElementById('sidebar-container');
    this.tabs = document.querySelectorAll('.sidebar-tab');
    this.panels = document.querySelectorAll('.sidebar-panel');
    this.toggle = document.getElementById('sidebar-toggle');
    this.resizer = document.getElementById('sidebar-resizer');
    this.overviewContent = document.getElementById('sidebar-overview-content');
    this.overviewHeader = document.getElementById('sidebar-overview-header');
    this.overviewContentWrapper = document.getElementById('sidebar-overview-content-wrapper');
    this.positionToggle = document.getElementById('sidebar-position-toggle');
    this.config = config;

    // Validate required elements
    if (!this.container) {
      console.error('Sidebar container not found');
      return;
    }

    this.isCollapsed = false;
    this.isResizing = false;
    this.startX = 0;
    this.startWidth = 0;
    this.position = 'right';

    this.init();
  }

  init() {
    if (!this.container) return;

    this.setupTabs();
    this.setupToggle();
    this.setupResizer();
    this.setupOverviewToggle();
    this.setupPositionToggle();
    this.setupKeyboardShortcuts();
    this.setupResponsive();
    this.initFromConfig();

    // Initialize CSS variables
    this.updateCSSVariables();
  }

  setupTabs() {
    this.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        this.switchTab(targetTab);
      });
    });
  }

  switchTab(tabName) {
    // Update active tab
    this.tabs.forEach((tab) => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }
    });

    // Update active panel
    this.panels.forEach((panel) => {
      if (panel.id === `${tabName}-panel`) {
        panel.classList.add('active');
        panel.setAttribute('aria-hidden', 'false');
      } else {
        panel.classList.remove('active');
        panel.setAttribute('aria-hidden', 'true');
      }
    });

  }

  setupToggle() {
    this.toggle.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // Add tooltips
    this.addTooltips();
  }

  setupOverviewToggle() {
    if (this.overviewHeader) {
      this.overviewHeader.addEventListener('click', () => {
        this.toggleOverview();
      });
    }
  }

  setupPositionToggle() {
    if (this.positionToggle) {
      this.positionToggle.addEventListener('click', () => {
        this.togglePosition();
      });
    }
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    this.container.classList.toggle('collapsed', this.isCollapsed);

    // Update container width directly
    if (this.isCollapsed) {
      this.container.style.width = 'var(--sidebar-collapsed-width)';
      document.documentElement.style.setProperty('--sidebar-width', 'var(--sidebar-collapsed-width)');
    } else {
      // Restore the saved width or default
      const savedWidth = this.config?.ui?.sidebar?.width || 350;
      this.container.style.width = savedWidth + 'px';
      document.documentElement.style.setProperty('--sidebar-width', savedWidth + 'px');
    }

    this.config.ui.sidebar.collapsed = this.isCollapsed;

    setTimeout(() => {
      this.#emitViewportResized();
    }, 320);
  }

  toggleOverview() {
    if (this.overviewContentWrapper) {
      const isCollapsed = this.overviewContentWrapper.classList.contains('collapsed');
      this.overviewContentWrapper.classList.toggle('collapsed', !isCollapsed);

      // Update the toggle arrow
      const toggle = this.overviewHeader?.querySelector('.sidebar-overview-toggle');
      if (toggle) {
        toggle.textContent = isCollapsed ? '▼' : '▶';
      }
    }
  }

  setupResizer() {
    this.resizer.addEventListener('mousedown', (e) => {
      this.startResize(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isResizing) {
        this.resize(e);
      }
    });

    document.addEventListener('mouseup', () => {
      if (this.isResizing) {
        this.stopResize();
      }
    });
  }

  startResize(e) {
    this.isResizing = true;
    this.startX = e.clientX;
    this.startWidth = this.container.offsetWidth;
    this.resizer.classList.add('resizing');

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  resize(e) {
    const deltaX = e.clientX - this.startX;
    const w = this.position === 'left' ? this.startWidth + deltaX : this.startWidth - deltaX;
    const newWidth = Math.max(200, Math.min(600, w));
    this.container.style.width = newWidth + 'px';
    document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
  }

  stopResize() {
    this.isResizing = false;
    this.resizer.classList.remove('resizing');

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    this.config.ui.sidebar.width = this.container.offsetWidth;
    this.#emitViewportResized();

  }

  #emitViewportResized() {
    const event = new CustomEvent('viewport-resized', {});
    document.dispatchEvent(event);
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + B to toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        this.toggleCollapse();
      }

      // Ctrl/Cmd + Shift + E to focus explorer
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        this.switchTab('explorer');
        this.focus();
      }

      // Ctrl/Cmd + Shift + S to focus settings
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        this.switchTab('settings');
        this.focus();
      }

      // Escape to close sidebar
      if (e.key === 'Escape' && this.container.classList.contains('collapsed')) {
        this.toggleCollapse();
      }
    });
  }

  focus() {
    this.container.focus();
  }

  show() {
    this.container.style.display = 'flex';
  }

  hide() {
    this.container.style.display = 'none';
  }

  setPosition(position) {
    // position can be 'left' or 'right'
    this.position = position;
    if (position === 'left' && !this.container.classList.contains('left')) {
      this.container.classList.add('left');
    } else if (position === 'right' && this.container.classList.contains('left')) {
      this.container.classList.remove('left');
    }
    this.config.ui.sidebar.position = position;
  }

  setupResponsive() {
    // With flexbox layout, the viewport automatically adjusts
    // No manual positioning needed
    window.addEventListener('resize', () => {
      // Trigger a reflow if needed
      const currentWidth = this.container.offsetWidth;
      this.container.style.width = currentWidth + 'px';
      // Update CSS custom property
      document.documentElement.style.setProperty('--sidebar-width', currentWidth + 'px');
    });
  }

  addTooltips() {
    const tooltips = {
      explorer                  : 'Cave and survey explorer (Ctrl+Shift+E)',
      settings                  : 'Scene and visualization settings (Ctrl+Shift+S)',
      'sidebar-toggle'          : 'Toggle sidebar (Ctrl+B)',
      'sidebar-position-toggle' : 'Toggle sidebar position (Left/Right)'
    };

    Object.entries(tooltips).forEach(([key, text]) => {
      let element;
      if (key === 'sidebar-toggle') {
        element = this.toggle;
      } else if (key === 'sidebar-position-toggle') {
        element = this.positionToggle;
      } else {
        element = document.querySelector(`[data-tab="${key}"]`);
      }

      if (element) {
        element.title = text;
      }
    });
  }

  togglePosition() {
    const currentPosition = this.container.classList.contains('left') ? 'left' : 'right';
    const newPosition = currentPosition === 'left' ? 'right' : 'left';
    this.setPosition(newPosition);

    // Update position toggle button background
    if (this.positionToggle) {
      if (newPosition === 'left') {
        this.positionToggle.style.background = 'no-repeat center/70% url(../icons/sidebar_right.svg)';
      } else {
        this.positionToggle.style.background = 'no-repeat center/70% url(../icons/sidebar_left.svg)';
      }
    }
  }

  initFromConfig() {

    const sidebarConfig = this.config.ui.sidebar;

    // Load position
    if (sidebarConfig.position === 'left') {
      this.setPosition('left');
      // Update position toggle button background for left position
      if (this.positionToggle) {
        this.positionToggle.style.background = 'no-repeat center/70% url(../icons/sidebar_right.svg)';
      }
    } else {
      this.setPosition('right');
    }

    let widthChanged = false;

    // Load collapsed state
    if (sidebarConfig.collapsed) {
      widthChanged = true;
      this.isCollapsed = true;
      this.container.classList.add('collapsed');
      this.container.style.width = 'var(--sidebar-collapsed-width)';
      document.documentElement.style.setProperty('--sidebar-width', 'var(--sidebar-collapsed-width)');
    } else if (sidebarConfig.width !== 350) {
      widthChanged = true;
      this.container.style.width = sidebarConfig.width + 'px';
      document.documentElement.style.setProperty('--sidebar-width', sidebarConfig.width + 'px');
    }

    // due to the animation, we need to wait for the animation to finish
    if (widthChanged) {
      setTimeout(() => {
        this.#emitViewportResized();
      }, 320);
    }

  }

  updateCSSVariables() {
    // Set initial CSS variables based on current state
    if (this.isCollapsed) {
      this.container.style.width = 'var(--sidebar-collapsed-width)';
      document.documentElement.style.setProperty('--sidebar-width', 'var(--sidebar-collapsed-width)');
    } else {
      const width = this.container.offsetWidth + 'px';
      document.documentElement.style.setProperty('--sidebar-width', width);
    }
  }
}
