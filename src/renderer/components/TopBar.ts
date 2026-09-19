/**
 * TopBar Component
 * Contextual top bar with breadcrumbs, actions, and global controls
 *
 * Features:
 * - Dynamic title/breadcrumb based on active view
 * - Contextual action buttons (Save, Run, Export, etc.)
 * - Global controls (project selector, environment indicator, user menu)
 * - Responsive action grouping
 */

import { appState } from '../store/app-state.js';

export interface TopBarAction {
  id: string;
  label: string;
  icon?: string;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}

export interface TopBarConfig {
  title?: string;
  breadcrumb?: string[];
  actions?: TopBarAction[];
  global?: {
    projectSelector?: boolean;
    environmentIndicator?: boolean;
    userMenu?: boolean;
  };
}

export interface TopBarOptions {
  container: HTMLElement;
}

export class TopBar {
  private container: HTMLElement;
  private currentConfig: TopBarConfig = {};
  private listeners: Map<string, Set<Function>> = new Map();

  constructor(options: TopBarOptions) {
    this.container = options.container;
  }

  /**
   * Initialize the top bar
   */
  public initialize(): void {
    document.documentElement.classList.toggle(
      'platform-macos', navigator.platform.toLowerCase().includes('mac')
    );
    this.render();
    this.attachEventListeners();
    console.log('[TopBar] Initialized');
  }

  /**
   * Set the context (update title, actions, etc.)
   */
  public setContext(viewId: string, config: TopBarConfig): void {
    this.currentConfig = config;
    this.render();
    // Listeners are now attached in initialize() or valid only for static elements
    // For dynamic elements re-rendered in render(), we might need re-attachment if we don't use delegation
    // But TopBar uses delegation on this.container for most things!
    // this.attachEventListeners(); <- REMOVED to prevent duplication
    console.log('[TopBar] Context updated for view:', viewId, config);
  }

  /**
   * Refresh project selector display (call when state changes)
   */
  public async refreshProjectSelector(): Promise<void> {
    console.log('[TopBar] Refreshing project selector display');
    this.render();

    // If dropdown is currently open, repopulate it
    const dropdown = this.container.querySelector('#project-dropdown') as HTMLElement;
    if (dropdown && dropdown.style.display === 'block') {
      await this.populateProjectDropdown();
    }
  }

  /**
   * Render the top bar HTML
   */
  private render(): void {
    const { title, breadcrumb, actions, global } = this.currentConfig;

    // Check if we're on Windows (frameless window)
    const isWindows = navigator.platform.toLowerCase().includes('win');

    if (isWindows) {
      // Two-row layout for Windows
      this.container.innerHTML = `
        <div class="top-bar-row top-bar-main-row">
          <div class="top-bar-left">
            <div class="top-bar-logo">
              <img src="icon.png" alt="FictionLab" style="width: 24px; height: 24px;">
            </div>
            ${this.renderMainMenu()}
          </div>
          <div class="top-bar-right">
            ${this.renderWindowControls()}
          </div>
        </div>

        ${title || breadcrumb ? `
          <div class="top-bar-row top-bar-title-row">
            ${this.renderTitleOrBreadcrumb(title, breadcrumb)}
            <div class="top-bar-center">
              ${actions ? this.renderActions(actions) : ''}
            </div>
            <div class="top-bar-right">
              ${global?.projectSelector ? this.renderProjectSelector() : ''}
              ${global?.environmentIndicator ? this.renderEnvironmentIndicator() : ''}
              ${global?.userMenu ? this.renderUserMenu() : ''}
            </div>
          </div>
        ` : ''}
      `;
    } else {
      // Single-row layout for Mac/Linux
      this.container.innerHTML = `
        <div class="top-bar-left">
          <div class="top-bar-logo">
            <img src="icon.png" alt="FictionLab" style="width: 24px; height: 24px;">
          </div>
          ${this.renderTitleOrBreadcrumb(title, breadcrumb)}
        </div>

        <div class="top-bar-center">
          ${actions ? this.renderActions(actions) : ''}
        </div>

        <div class="top-bar-right">
          ${global?.projectSelector ? this.renderProjectSelector() : ''}
          ${global?.environmentIndicator ? this.renderEnvironmentIndicator() : ''}
          ${global?.userMenu ? this.renderUserMenu() : ''}
        </div>
      `;
    }
  }

  /**
   * Render title or breadcrumb
   */
  private renderTitleOrBreadcrumb(title?: string, breadcrumb?: string[]): string {
    if (breadcrumb && breadcrumb.length > 0) {
      const breadcrumbItems = breadcrumb.map((item, index) => {
        const isLast = index === breadcrumb.length - 1;
        const activeClass = isLast ? 'active' : '';
        return `
          <span class="breadcrumb-item ${activeClass}" data-breadcrumb-index="${index}">
            ${item}
          </span>
          ${!isLast ? '<span class="breadcrumb-separator">›</span>' : ''}
        `;
      }).join('');

      return `<div class="top-bar-breadcrumb">${breadcrumbItems}</div>`;
    }

    if (title) {
      return `<div class="top-bar-title">${this.escapeHtml(title)}</div>`;
    }

    return '';
  }

  /**
   * Render main menu (Windows only - for frameless window)
   */
  private renderMainMenu(): string {
    const menuItems = [
      { id: 'file', label: 'File' },
      { id: 'edit', label: 'Edit' },
      { id: 'view', label: 'View' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'diagnostics', label: 'Diagnostics' },
      { id: 'help', label: 'Help' },
    ];

    return `
      <nav class="top-bar-menu">
        ${menuItems.map(item => `
          <div class="menu-item" data-menu-id="${item.id}">
            ${item.label}
          </div>
        `).join('')}
      </nav>
    `;
  }

  /**
   * Render window controls (minimize, maximize, close) for Windows
   */
  private renderWindowControls(): string {
    return `
      <div class="window-controls">
        <button class="window-control-btn minimize" data-window-action="minimize" title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor"/>
          </svg>
        </button>
        <button class="window-control-btn maximize" data-window-action="maximize" title="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1"/>
          </svg>
        </button>
        <button class="window-control-btn close" data-window-action="close" title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1"/>
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1"/>
          </svg>
        </button>
      </div>
    `;
  }

  /**
   * Render action buttons
   */
  private renderActions(actions: TopBarAction[]): string {
    if (actions.length === 0) return '';

    return actions.map(action => {
      const variant = action.variant || 'default';
      const disabledAttr = action.disabled ? 'disabled' : '';
      const icon = action.icon ? `<span class="action-icon">${action.icon}</span>` : '';
      const label = `<span class="action-label">${this.escapeHtml(action.label)}</span>`;

      return `
        <button class="top-bar-action ${variant}"
                data-action-id="${action.id}"
                ${disabledAttr}>
          ${icon}
          ${label}
        </button>
      `;
    }).join('');
  }

  /**
   * Render project/series selector
   */
  private renderProjectSelector(): string {
    // Get app state
    let activeSeries: any = null;
    let activeProject: any = null;

    try {
      activeSeries = appState.getActiveSeries();
      activeProject = appState.getActiveProject();
      console.log('[TopBar] renderProjectSelector - activeProject:', activeProject);
      console.log('[TopBar] renderProjectSelector - activeSeries:', activeSeries);
      console.log('[TopBar] renderProjectSelector - activeProjectId:', appState.getActiveProjectId());
      console.log('[TopBar] renderProjectSelector - projects in state:', appState.getState().projects);
    } catch (error) {
      console.error('[TopBar] Failed to access app state:', error);
    }

    let displayText = 'No Project Selected';
    if (activeSeries) {
      displayText = activeProject
        ? `${activeProject.name || activeProject.project_name} / ${activeSeries.name}`
        : activeSeries.name;
    } else if (activeProject) {
      displayText = activeProject.name || activeProject.project_name || 'Unnamed Project';
    }

    console.log('[TopBar] renderProjectSelector - displayText:', displayText);

    return `
      <div class="project-selector" data-action="toggle-project-selector">
        <span class="project-selector-icon">📁</span>
        <span class="project-selector-text">${this.escapeHtml(displayText)}</span>
        <span class="project-selector-arrow">▼</span>
      </div>
      <div class="project-dropdown" id="project-dropdown" style="display: none;">
        <div class="project-dropdown-header">
          <button class="project-dropdown-action" data-action="create-project">
            + Create New Project
          </button>
        </div>
        <div class="project-dropdown-divider"></div>
        <div class="project-dropdown-items" id="project-dropdown-items">
          <!-- Will be populated dynamically -->
        </div>
      </div>
    `;
  }

  /**
   * Render environment indicator
   */
  private renderEnvironmentIndicator(): string {
    // Get actual system status from DOM (updated by dashboard handlers)
    const statusTextElement = document.getElementById('dashboard-status-text');
    const statusIndicator = document.getElementById('dashboard-status-indicator');

    let status: 'healthy' | 'warning' | 'error' = 'error';
    let statusText = 'Status Unknown';

    if (statusTextElement && statusIndicator) {
      const currentStatusText = statusTextElement.textContent || '';

      // Map dashboard status to environment indicator status
      if (currentStatusText === 'System Ready') {
        status = 'healthy';
        statusText = 'All Systems Operational';
      } else if (currentStatusText === 'System Starting' || currentStatusText === 'System Degraded') {
        status = 'warning';
        statusText = currentStatusText;
      } else if (currentStatusText === 'System Offline') {
        status = 'error';
        statusText = 'System Offline';
      } else {
        // Unknown status
        status = 'error';
        statusText = currentStatusText || 'Status Unknown';
      }
    }

    return `
      <div class="environment-indicator">
        <span class="environment-dot ${status}"></span>
        <span class="environment-text">${statusText}</span>
      </div>
    `;
  }

  /**
   * Render user menu
   */
  private renderUserMenu(): string {
    // TODO: Get actual user data
    const userName = 'User';
    const userInitials = userName.substring(0, 2).toUpperCase();

    return `
      <div class="user-menu" data-action="toggle-user-menu">
        <div class="user-avatar">${userInitials}</div>
        <span class="user-name">${this.escapeHtml(userName)}</span>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(): void {
    // Action button clicks
    // Remove existing listener if any (simplistic approach, or just ensure we don't add multiple)
    // Since we are using event delegation on this.container, we only need to attach ONCE.
    // We'll trust strict initialization.
    
    // Action button clicks
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Handle action button click
      const actionButton = target.closest('.top-bar-action') as HTMLElement;
      if (actionButton && !actionButton.hasAttribute('disabled')) {
        const actionId = actionButton.dataset.actionId;
        if (actionId) {
          console.log('[TopBar] Action clicked:', actionId);
          this.emit('action-clicked', actionId);
        }
      }

      // Handle breadcrumb click
      const breadcrumbItem = target.closest('.breadcrumb-item:not(.active)') as HTMLElement;
      if (breadcrumbItem) {
        const index = parseInt(breadcrumbItem.dataset.breadcrumbIndex || '0');
        console.log('[TopBar] Breadcrumb clicked:', index);
        this.emit('breadcrumb-clicked', index);
      }

      // Handle project selector toggle
      if (target.closest('[data-action="toggle-project-selector"]')) {
        this.toggleProjectSelector();
      }

      // Handle create project
      const createProjectBtn = target.closest('[data-action="create-project"]');
      if (createProjectBtn) {
        console.log('[TopBar] Create project clicked');
        this.emit('create-project');
        this.closeProjectSelector();
      }

      // Handle project selection
      const projectItem = target.closest('[data-action="select-project"]') as HTMLElement;
      if (projectItem) {
        const projectId = parseInt(projectItem.dataset.projectId || '0');
        const projectName = projectItem.dataset.projectName || '';
        console.log('[TopBar] Project selected:', projectId);
        this.emit('project-selected', { projectId, projectName });
        this.closeProjectSelector();
      }

      // Handle user menu toggle
      if (target.closest('[data-action="toggle-user-menu"]')) {
        console.log('[TopBar] User menu clicked');
        this.emit('user-menu-clicked');
      }

      // Handle window controls (minimize, maximize, close)
      const windowControlBtn = target.closest('.window-control-btn') as HTMLElement;
      if (windowControlBtn) {
        const action = windowControlBtn.dataset.windowAction;
        if (action) {
          this.handleWindowControl(action);
        }
      }

      // Handle menu item clicks
      const menuItem = target.closest('.menu-item') as HTMLElement;
      if (menuItem) {
        const menuId = menuItem.dataset.menuId;
        if (menuId) {
          console.log('[TopBar] Menu clicked:', menuId);

          // Show dropdown menu for File, Edit, View
          if (['file', 'edit', 'view'].includes(menuId)) {
            this.showMenuDropdown(menuId, menuItem);
          } else {
            // For other menus, emit the event
            this.emit('menu-clicked', menuId);
          }
        }
      }

      // Handle dropdown menu item clicks
      const dropdownItem = target.closest('.menu-dropdown-item') as HTMLElement;
      if (dropdownItem) {
        const action = dropdownItem.dataset.action;
        if (action) {
          console.log('[TopBar] Dropdown action:', action);
          this.emit('menu-action', action);
          this.closeAllDropdowns();
        }
      }
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Close menu dropdowns if clicking outside
      if (!target.closest('.menu-item') && !target.closest('.menu-dropdown')) {
        const dropdowns = document.querySelectorAll('.menu-dropdown');
        dropdowns.forEach(dropdown => {
          const menuElement = (dropdown as any).__menuElement;
          if (menuElement) {
            menuElement.classList.remove('active');
          }
          dropdown.remove();
        });
      }

      // Close project selector if clicking outside
      if (!target.closest('.project-selector') && !target.closest('.project-dropdown')) {
        this.closeProjectSelector();
      }
    });
  }

  /**
   * Toggle project selector dropdown
   */
  private async toggleProjectSelector(): Promise<void> {
    const dropdown = this.container.querySelector('#project-dropdown') as HTMLElement;
    if (!dropdown) return;

    const isOpen = dropdown.style.display === 'block';

    if (isOpen) {
      dropdown.style.display = 'none';
    } else {
      // Populate dropdown with projects and series
      await this.populateProjectDropdown();
      dropdown.style.display = 'block';
    }
  }

  /**
   * Close project selector dropdown
   */
  private closeProjectSelector(): void {
    const dropdown = this.container.querySelector('#project-dropdown') as HTMLElement;
    if (dropdown) {
      dropdown.style.display = 'none';
    }
  }

  /**
   * Populate project dropdown with real data
   */
  private async populateProjectDropdown(): Promise<void> {
    const container = this.container.querySelector('#project-dropdown-items');
    if (!container) return;

    try {
      const electronAPI = (window as any).electronAPI;

      // Fetch projects
      console.log('[TopBar] Fetching projects from backend...');
      const projects = await electronAPI.invoke('project:list');
      console.log('[TopBar] Received projects:', projects);
      const activeProjectId = appState.getActiveProjectId();
      console.log('[TopBar] Active project ID:', activeProjectId);

      let html = '';

      if (projects.length === 0) {
        html = `
          <div class="project-dropdown-empty">
            No projects yet. Create one to get started!
          </div>
        `;
      } else {
        projects.forEach((project: any) => {
          const isActive = project.id === activeProjectId;
          // Handle both project.name and project.project_name (database field)
          const projectName = project.name || project.project_name || 'Unnamed Project';
          const folderPath = project.folder_path || project.folder_location || '';

          html += `
            <div class="project-dropdown-project ${isActive ? 'active' : ''}"
                 data-action="select-project"
                 data-project-id="${project.id}"
                 data-project-name="${this.escapeHtml(projectName)}">
              ${isActive ? '✓ ' : ''}${this.escapeHtml(projectName)}
              <div class="project-dropdown-path">${this.escapeHtml(folderPath)}</div>
            </div>
          `;
        });
      }

      container.innerHTML = html;
    } catch (error) {
      console.error('[TopBar] Failed to populate project dropdown:', error);
      container.innerHTML = `
        <div class="project-dropdown-error">
          Failed to load projects
        </div>
      `;
    }
  }

  /**
   * Show dropdown menu for File, Edit, View menus
   */
  private showMenuDropdown(menuId: string, menuElement: HTMLElement): void {
    // Close any existing dropdowns
    this.closeAllDropdowns();

    // Get menu items based on menuId
    const menuItems = this.getMenuItems(menuId);
    if (menuItems.length === 0) return;

    // Create dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'menu-dropdown';
    dropdown.id = `menu-dropdown-${menuId}`;

    // Position dropdown below menu item
    const rect = menuElement.getBoundingClientRect();
    dropdown.style.position = 'absolute';
    dropdown.style.top = `${rect.bottom}px`;
    dropdown.style.left = `${rect.left}px`;

    // Add menu items
    dropdown.innerHTML = menuItems.map(item => {
      if (item.separator) {
        return '<div class="menu-dropdown-separator"></div>';
      }
      const disabledClass = item.disabled ? 'disabled' : '';
      const shortcut = item.shortcut ? `<span class="menu-shortcut">${item.shortcut}</span>` : '';
      return `
        <div class="menu-dropdown-item ${disabledClass}" data-action="${item.action}">
          <span class="menu-item-label">${item.label}</span>
          ${shortcut}
        </div>
      `;
    }).join('');

    // Add to DOM
    document.body.appendChild(dropdown);

    // Mark menu as active
    menuElement.classList.add('active');

    // Store reference for cleanup
    (dropdown as any).__menuElement = menuElement;
  }

  /**
   * Get menu items for a specific menu
   */
  private getMenuItems(menuId: string): Array<{label: string, action: string, shortcut?: string, disabled?: boolean, separator?: boolean}> {
    switch (menuId) {
      case 'file':
        return [
          { label: 'New Project', action: 'file-new-project', shortcut: 'Ctrl+N' },
          { label: 'Open Project', action: 'file-open-project', shortcut: 'Ctrl+O' },
          { separator: true } as any,
          { label: 'Save', action: 'file-save', shortcut: 'Ctrl+S', disabled: true },
          { label: 'Save As...', action: 'file-save-as', shortcut: 'Ctrl+Shift+S', disabled: true },
          { separator: true } as any,
          { label: 'Export...', action: 'file-export' },
          { separator: true } as any,
          { label: 'Exit', action: 'file-exit', shortcut: 'Alt+F4' },
        ];

      case 'edit':
        return [
          { label: 'Undo', action: 'edit-undo', shortcut: 'Ctrl+Z', disabled: true },
          { label: 'Redo', action: 'edit-redo', shortcut: 'Ctrl+Y', disabled: true },
          { separator: true } as any,
          { label: 'Cut', action: 'edit-cut', shortcut: 'Ctrl+X', disabled: true },
          { label: 'Copy', action: 'edit-copy', shortcut: 'Ctrl+C', disabled: true },
          { label: 'Paste', action: 'edit-paste', shortcut: 'Ctrl+V', disabled: true },
          { separator: true } as any,
          { label: 'Preferences', action: 'edit-preferences', shortcut: 'Ctrl+,' },
        ];

      case 'view':
        return [
          { label: 'Dashboard', action: 'view-dashboard', shortcut: 'Ctrl+1' },
          { label: 'Workflows', action: 'view-workflows', shortcut: 'Ctrl+2' },
          { label: 'Library', action: 'view-library', shortcut: 'Ctrl+3' },
          { label: 'Plugins', action: 'view-plugins', shortcut: 'Ctrl+4' },
          { separator: true } as any,
          { label: 'Settings', action: 'view-settings' },
          { separator: true } as any,
          { label: 'Reload', action: 'view-reload', shortcut: 'Ctrl+R' },
        ];

      case 'plugins':
        return [
          { label: 'Manage Plugins', action: 'plugins-manage' },
        ];

      default:
        return [];
    }
  }

  /**
   * Close all dropdown menus
   */
  private closeAllDropdowns(): void {
    // Close menu dropdowns
    const dropdowns = document.querySelectorAll('.menu-dropdown');
    dropdowns.forEach(dropdown => {
      const menuElement = (dropdown as any).__menuElement;
      if (menuElement) {
        menuElement.classList.remove('active');
      }
      dropdown.remove();
    });

    // Close project selector
    this.closeProjectSelector();
  }

  /**
   * Handle window control actions (minimize, maximize, close)
   */
  private handleWindowControl(action: string): void {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      console.error('[TopBar] electronAPI not available');
      return;
    }

    switch (action) {
      case 'minimize':
        electronAPI.window?.minimize();
        break;
      case 'maximize':
        electronAPI.window?.maximize();
        break;
      case 'close':
        electronAPI.window?.close();
        break;
      default:
        console.warn('[TopBar] Unknown window action:', action);
    }
  }

  /**
   * Update a specific action (enable/disable, change label, etc.)
   */
  public updateAction(actionId: string, updates: Partial<TopBarAction>): void {
    if (!this.currentConfig.actions) return;

    const action = this.currentConfig.actions.find(a => a.id === actionId);
    if (action) {
      Object.assign(action, updates);
      this.render();
      this.attachEventListeners();
    }
  }

  /**
   * Set loading state for an action
   */
  public setActionLoading(actionId: string, loading: boolean): void {
    const actionButton = this.container.querySelector(`[data-action-id="${actionId}"]`) as HTMLButtonElement;
    if (actionButton) {
      if (loading) {
        actionButton.disabled = true;
        const originalContent = actionButton.innerHTML;
        actionButton.dataset.originalContent = originalContent;
        actionButton.innerHTML = '<span class="loading-spinner"></span>';
      } else {
        actionButton.disabled = false;
        const originalContent = actionButton.dataset.originalContent;
        if (originalContent) {
          actionButton.innerHTML = originalContent;
          delete actionButton.dataset.originalContent;
        }
      }
    }
  }

  /**
   * Show a notification in the top bar (temporary)
   */
  public showNotification(message: string, type: 'success' | 'error' | 'info' = 'info', duration: number = 3000): void {
    const notification = document.createElement('div');
    notification.className = `top-bar-notification ${type}`;
    notification.textContent = message;

    this.container.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, duration);
  }

  /**
   * Update environment indicator status
   * This method is called by the dashboard handlers when status changes
   */
  public updateEnvironmentStatus(status: 'healthy' | 'warning' | 'error', text?: string): void {
    const indicator = this.container.querySelector('.environment-indicator');
    if (indicator) {
      const dot = indicator.querySelector('.environment-dot');
      const textEl = indicator.querySelector('.environment-text');

      if (dot) {
        // Remove all status classes first
        dot.classList.remove('healthy', 'warning', 'error');
        // Add the new status class
        dot.classList.add(status);
      }

      if (textEl && text) {
        textEl.textContent = text;
      }
    }
  }

  /**
   * Refresh environment indicator based on current system status
   * Called periodically to sync TopBar with dashboard status
   */
  public refreshEnvironmentIndicator(): void {
    // Re-render to pick up latest status from DOM
    this.render();
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Event emitter - register a listener
   */
  public on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Event emitter - unregister a listener
   */
  public off(event: string, callback: Function): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(callback);
    }
  }

  /**
   * Event emitter - emit an event
   */
  private emit(event: string, ...args: any[]): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`[TopBar] Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Destroy the top bar
   */
  public destroy(): void {
    this.container.innerHTML = '';
    this.listeners.clear();
  }
}
