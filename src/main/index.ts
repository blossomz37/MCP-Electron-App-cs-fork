import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as prerequisites from './prerequisites';
import logger, { initializeLogger, getRecentLogs, LogCategory, logWithCategory } from './logger';
import {
  openLogFile,
  openLogsDirectory,
  exportDiagnosticReport,
  testSystem,
  generateGitHubIssueTemplate,
  openGitHubIssue,
} from './diagnostics';
import * as docker from './docker';
import * as dockerImages from './docker-images';
import * as envConfig from './env-config';
import * as installationWizard from './installation-wizard';
import * as clientSelection from './client-selection';
import * as typingMindAutoConfig from './typingmind-auto-config';
import * as mcpSystem from './mcp-system';
import * as databaseBackup from './database-backup';
import * as databaseAdmin from './database-admin';
import * as updater from './updater';
import * as setupWizard from './setup-wizard';
import * as appSettings from './app-settings';
import type { CurrentUserSetting } from '../types/identity';
import * as migrations from './migrations';
import { repositoryManager } from './repository-manager';
import { createBuildOrchestrator } from './build-orchestrator';
import { createBuildPipelineOrchestrator, resolveConfigPath } from './build-pipeline-orchestrator';
import { ProgressThrottler, IPC_CHANNELS } from '../types/ipc';
import { registerHandler, getRegisteredHandlers } from './ipc-registry';
import { pluginManager } from './plugin-manager';
import { pluginViewManager } from './plugin-views';
import { initializeDatabasePool, getDatabasePool, closeDatabasePool } from './database-connection';
import { getProviderManager } from './llm/provider-manager';
import type { LLMProviderConfig } from '../types/llm-providers';
import type {
  RepositoryCloneRequest,
  RepositoryCloneResponse,
  RepositoryCheckoutRequest,
  RepositoryCheckoutResponse,
  RepositoryStatusRequest,
  RepositoryStatusResponse,
  RepositoryBranchRequest,
  RepositoryBranchResponse,
  RepositoryCommitRequest,
  RepositoryCommitResponse,
  RepositoryCancelResponse,
  BuildNpmInstallRequest,
  BuildNpmInstallResponse,
  BuildNpmBuildRequest,
  BuildNpmBuildResponse,
  BuildDockerBuildRequest,
  BuildDockerBuildResponse,
  BuildExecuteChainRequest,
  BuildExecuteChainResponse,
  BuildExecuteCustomScriptRequest,
  BuildExecuteCustomScriptResponse,
  BuildCancelResponse,
  PipelineExecuteRequest,
  PipelineExecuteResponse,
  PipelineCancelResponse,
  PipelineStatusResponse,
} from '../types/ipc';

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;

/**
 * Get the correct icon path for the current platform and packaging state
 */
function getIconPath(): string {
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  
  if (app.isPackaged) {
    // In packaged apps, resources are in process.resourcesPath
    return path.join(process.resourcesPath, 'resources', iconFileName);
  } else {
    // In development, use relative path from compiled JS location
    return path.join(__dirname, '../resources', iconFileName);
  }
}

/**
 * Build the base application menu template.
 *
 * Returns a fresh `MenuItemConstructorOptions[]` array (plain options, not live
 * `MenuItem` instances) every time it's called. Other modules (e.g.
 * plugin-manager's `updatePluginMenu()`) should build the full menu by
 * splicing into a fresh copy of this template rather than reading back
 * `Menu.getApplicationMenu().items` — round-tripping live MenuItem instances
 * through `Menu.buildFromTemplate()` silently drops their `click` handlers.
 */
export function getBaseMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Diagnostics',
      submenu: [
        {
          label: 'View Logs',
          click: async () => {
            try {
              await openLogFile();
            } catch (error) {
              logger.error('Error opening log file:', error);
            }
          },
        },
        {
          label: 'Open Logs Directory',
          click: async () => {
            try {
              await openLogsDirectory();
            } catch (error) {
              logger.error('Error opening logs directory:', error);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Export Diagnostic Report',
          click: async () => {
            try {
              const result = await exportDiagnosticReport();
              if (result.success) {
                logger.info('Diagnostic report exported successfully');
              } else {
                logger.error('Failed to export diagnostic report:', result.error);
              }
            } catch (error) {
              logger.error('Error exporting diagnostic report:', error);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Test System',
          click: async () => {
            try {
              const results = await testSystem();
              logger.info('System test completed', results);
              // Send results to renderer if window exists
              if (mainWindow) {
                mainWindow.webContents.send('system-test-results', results);
              }
            } catch (error) {
              logger.error('Error running system tests:', error);
            }
          },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'User Guide',
          click: async () => {
            await shell.openExternal('https://github.com/RLRyals/MCP-Electron-App/blob/main/docs/USER-GUIDE.md');
          },
        },
        {
          label: 'Quick Start',
          click: async () => {
            await shell.openExternal('https://github.com/RLRyals/MCP-Electron-App/blob/main/docs/QUICK-START.md');
          },
        },
        {
          label: 'Troubleshooting',
          click: async () => {
            await shell.openExternal('https://github.com/RLRyals/MCP-Electron-App/blob/main/docs/TROUBLESHOOTING.md');
          },
        },
        {
          label: 'FAQ',
          click: async () => {
            await shell.openExternal('https://github.com/RLRyals/MCP-Electron-App/blob/main/docs/FAQ.md');
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: async () => {
            try {
              const updates = await updater.checkForAllUpdates();
              logger.info('Update check completed', updates);
              // Send results to renderer if window exists
              if (mainWindow) {
                mainWindow.webContents.send('updater:check-complete', updates);
              }
            } catch (error) {
              logger.error('Error checking for updates:', error);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Report Issue',
          click: async () => {
            try {
              await openGitHubIssue('General Issue', 'Please describe the issue');
            } catch (error) {
              logger.error('Error opening GitHub issue:', error);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'About FictionLab',
          click: () => {
            const aboutMessage = `FictionLab v${app.getVersion()}\n\nYour AI-powered writing laboratory - a professional workspace for authors.\n\nCopyright © 2025 FictionLab\nLicense: MIT`;
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About FictionLab',
              message: 'FictionLab',
              detail: aboutMessage,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];
}

/**
 * Create the application menu
 */
function createMenu(): void {
  const menu = Menu.buildFromTemplate(getBaseMenuTemplate());
  Menu.setApplicationMenu(menu);
}

/**
 * Create the setup wizard window
 */
function createWizardWindow(): void {
  logger.info('Creating setup wizard window...');

  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    icon: iconPath,
    title: 'MCP Writing System - Setup Wizard',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false, // Don't show until ready
  });

  // Load the setup wizard HTML file
  const wizardPath = path.join(__dirname, '../renderer/setup-wizard.html');
  mainWindow.loadFile(wizardPath);

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    logger.info('Wizard window ready to show');
    mainWindow?.show();
  });

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Setup wizard window created');
}

/**
 * Create the migration wizard window
 */
function createMigrationWizardWindow(): void {
  logger.info('Creating migration wizard window...');

  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    title: 'MCP Writing System - Migration Wizard',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false, // Don't show until ready
  });

  // Load the migration wizard HTML file
  const migrationWizardPath = path.join(__dirname, '../renderer/migration-wizard.html');
  mainWindow.loadFile(migrationWizardPath);

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    logger.info('Migration wizard window ready to show');
    mainWindow?.show();
  });

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Migration wizard window created');
}

/**
 * Create the main application window
 */
function createWindow(): void {
  logger.info('Creating main window...');

  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'FictionLab',
    icon: iconPath,
    frame: process.platform !== 'win32', // Frameless on Windows, native frame on Mac/Linux
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', // Native macOS style
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false, // Don't show until ready
  });

  // Load the index.html file
  const indexPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(indexPath);

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    logger.info('Window ready to show');
    mainWindow?.show();
  });

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set main window for plugin view manager
  pluginViewManager.setMainWindow(mainWindow);

  logger.info('Main window created');
}

/**
 * Create the Typing Mind window
 */
function openTypingMindInBrowser(url: string): void {
  logger.info(`Opening Typing Mind in default browser: ${url}`);

  // Open in default browser
  shell.openExternal(url).catch((error) => {
    logger.error('Failed to open Typing Mind in browser', error);
  });
}

import { registerImportHandlers } from './handlers/import-handlers';
import { registerBundledPluginsHandlers } from './handlers/bundled-plugins-handlers';
import { registerWorkflowHandlers } from './handlers/workflow-handlers';
import { registerPluginUpdateHandlers } from './handlers/plugin-update-handlers';
import { registerGenrePackHandlers } from './handlers/genre-pack-handlers';

/**
 * Build the README.md dropped into a newly-initialized project root
 * (project:initialize-workspace handler). Documents the SA v2-aligned
 * scaffold (outputs/, series-planning/, .claude/) and the per-book
 * isolation rule: each book's artifacts live under outputs/book_N/ and
 * book N+1 must never overwrite book N's folder/files. See issue #165.
 */
function buildProjectReadme(projectName: string): string {
  return `# ${projectName}

This project was initialized by FictionLab / MCP Electron App using the
Series Architect v2 scaffold.

## Folder layout

- \`outputs/\` — everything the Series Architect (SA) workflows write:
  series-level documents (e.g. \`INDEX.md\`, \`series_bible.md\`,
  \`market_research.md\`, \`genre_pack.json\`, \`series_framework.md\`) live
  flat in \`outputs/\`, shared across the whole series. Per-book artifacts
  live in their own \`outputs/book_N/\` subfolder (see below).
- \`series-planning/\` — the Series Architect agent's own working folder.
- \`.claude/\` — app + workflow metadata: \`settings.json\` (project settings,
  including the selected genre pack id once one is chosen) and a
  \`CLAUDE.md\` template used to resume workflow runs.

Nothing else is scaffolded up front. Workflow steps create any additional
folder they need at runtime (e.g. \`outputs/book_N/\`) via
\`fs.ensureDir\`/\`fs-extra\`'s automatic parent-directory creation, so an
empty folder here would only go stale -- the folders above are the ones
every SA v2 workflow run actually reads from and writes to.

## Per-book isolation (binding rule)

Each book in the series gets its **own** folder: \`outputs/book_1/\`,
\`outputs/book_2/\`, \`outputs/book_3/\`, and so on. This is enforced by the
SA v2 workflows themselves (e.g. \`dramatica-storyform\` and
\`series-architect-development\`), which parameterize every per-book file
path by the current book number.

**Book N+1 must never overwrite Book N's folder or files.** If you are
authoring or modifying a workflow step that writes book-specific content,
make sure its output path is parameterized by the book number (e.g.
\`outputs/book_{{currentBookNumber}}/...\`) rather than a fixed or shared
path -- a hardcoded or unparameterized path is a bug that will silently
clobber a previous book's work.
`;
}

/**
 * Set up IPC handlers for communication between main and renderer processes
 */
function setupIPC(): void {
  // Register import handlers
  registerImportHandlers();

  // Register bundled plugins handlers
  registerBundledPluginsHandlers();

  // Register plugin update handlers
  registerPluginUpdateHandlers();

  // Register workflow handlers
  registerWorkflowHandlers();

  // Register genre pack handlers
  registerGenrePackHandlers();

  // Example IPC handler - ping/pong
  registerHandler('ping', "Health-check ping/pong", async () => {

    logger.info('Received ping from renderer');
    return 'pong';
  });

  // Get app version
  registerHandler('get-app-version', "Get the running app version", async () => {
    return app.getVersion();
  });

  // Get platform info
  registerHandler('get-platform-info', "Get platform/arch/node version info", async () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
    };
  });

  // IPC introspection: list every registered channel (app + plugin-namespaced),
  // optionally filtered to channels starting with `prefix`.
  registerHandler(
    'help',
    'List registered IPC channels (optionally filtered by a channel-name prefix), for introspection/discovery by external IPC clients',
    async (_event, prefix?: string) => {
      return getRegisteredHandlers(prefix);
    }
  );

  // Window controls (for frameless window on Windows)
  registerHandler('window:minimize', "", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  registerHandler('window:maximize', "", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.restore();
      } else {
        mainWindow.maximize();
      }
    }
  });

  registerHandler('window:close', "", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  // Prerequisites checks
  registerHandler('prerequisites:check-docker', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Checking Docker installation...');
    return await prerequisites.checkDockerInstalled();
  });

  registerHandler('prerequisites:check-docker-running', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Checking if Docker is running...');
    return await prerequisites.checkDockerRunning();
  });

  registerHandler('prerequisites:get-docker-version', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Getting Docker version...');
    return await prerequisites.getDockerVersion();
  });

  registerHandler('prerequisites:check-git', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Checking Git installation...');
    return await prerequisites.checkGit();
  });

  registerHandler('prerequisites:check-wsl', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Checking WSL status...');
    return await prerequisites.checkWSL();
  });

  registerHandler('prerequisites:check-all', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Running all prerequisite checks...');
    return await prerequisites.checkAll();
  });

  registerHandler('prerequisites:get-platform-info', "", async () => {
    return prerequisites.getPlatformInfo();
  });

  // Logging and diagnostics IPC handlers
  registerHandler('logger:open', "", async () => {
    logger.info('Opening log file...');
    return await openLogFile();
  });

  registerHandler('logger:open-directory', "", async () => {
    logger.info('Opening logs directory...');
    return await openLogsDirectory();
  });

  registerHandler('logger:export', "", async () => {
    logger.info('Exporting diagnostic report...');
    return await exportDiagnosticReport();
  });

  registerHandler('logger:test-system', "", async () => {
    logger.info('Running system tests...');
    return await testSystem();
  });

  registerHandler('logger:get-logs', "", async (_, lines: number = 100) => {
    return getRecentLogs(lines);
  });

  registerHandler('logger:get-log-level', "", async () => {
    const { getConsoleLogLevel } = await import('./logger.js');
    return getConsoleLogLevel();
  });

  registerHandler('logger:set-log-level', "", async (_, level: 'debug' | 'info' | 'warn' | 'error') => {
    const { setConsoleLogLevel } = await import('./logger.js');
    setConsoleLogLevel(level);
    return { success: true, level };
  });

  registerHandler('logger:enable-verbose', "", async () => {
    const { enableVerboseLogging } = await import('./logger.js');
    enableVerboseLogging();
    // Also reset env config logging to show full details
    const { resetConfigLogging } = await import('./env-config.js');
    resetConfigLogging();
    return { success: true };
  });

  registerHandler('logger:disable-verbose', "", async () => {
    const { disableVerboseLogging } = await import('./logger.js');
    disableVerboseLogging();
    return { success: true };
  });

  registerHandler('logger:generate-issue-template', "", async (_, title: string, message: string, stack?: string) => {
    return generateGitHubIssueTemplate(title, message, stack);
  });

  registerHandler('logger:open-github-issue', "", async (_, title: string, message: string, stack?: string) => {
    return await openGitHubIssue(title, message, stack);
  });

  // Environment configuration IPC handlers
  registerHandler('env:get-config', "Get the current .env configuration", async () => {
    logger.info('Getting environment configuration...');
    return await envConfig.loadEnvConfig();
  });

  registerHandler('env:save-config', "Save the .env configuration", async (_, config: envConfig.EnvConfig) => {
    logger.info('Saving environment configuration...');
    logger.info('Config credentials check:', {
      hasPassword: !!config.POSTGRES_PASSWORD,
      hasToken: !!config.MCP_AUTH_TOKEN,
      passwordLength: config.POSTGRES_PASSWORD?.length || 0,
      tokenLength: config.MCP_AUTH_TOKEN?.length || 0
    });

    const validation = envConfig.validateConfig(config);
    if (!validation.valid) {
      logger.error('Config validation failed:', validation.errors);
      return { success: false, error: 'Validation failed: ' + validation.errors.join(', ') };
    }

    logger.info('Config validation passed, proceeding to save');
    const result = await envConfig.saveEnvConfig(config);

    // Update GitHub credentials if token changed
    if (config.GITHUB_TOKEN) {
      try {
        const { getGitHubCredentialManager } = await import('./github-credential-manager');
        getGitHubCredentialManager(config.GITHUB_TOKEN);
        logger.info('GitHub credentials updated from saved config');
      } catch (error) {
        logger.warn('Error updating GitHub credentials:', error);
      }
    }

    return result;
  });

  registerHandler('env:generate-password', "Generate a random password", async (_, length?: number) => {
    logger.info('Generating password...');
    return envConfig.generatePassword(length);
  });

  registerHandler('env:generate-token', "Generate a random auth token", async () => {
    logger.info('Generating auth token...');
    return envConfig.generateAuthToken();
  });

  registerHandler('env:check-port', "Check whether a single port is available", async (_, port: number) => {
    logger.info(`Checking if port ${port} is available...`);
    return await envConfig.checkPortAvailable(port);
  });

  registerHandler('env:reset-defaults', "Reset .env configuration to defaults", async () => {
    logger.info('Resetting to default configuration...');
    return {
      ...envConfig.DEFAULT_CONFIG,
      POSTGRES_PASSWORD: envConfig.generatePassword(),
      MCP_AUTH_TOKEN: envConfig.generateAuthToken(),
    };
  });

  registerHandler('env:validate-config', "Validate an .env configuration object", async (_, config: envConfig.EnvConfig) => {
    return envConfig.validateConfig(config);
  });

  registerHandler('env:calculate-password-strength', "Calculate a password strength score", async (_, password: string) => {
    return envConfig.calculatePasswordStrength(password);
  });

  registerHandler('env:get-env-file-path', "Get the filesystem path to the .env file", async () => {
    return envConfig.getEnvFilePath();
  });

  registerHandler('env:file-exists', "Check whether the .env file exists", async () => {
    const envPath = envConfig.getEnvFilePath();
    return fs.existsSync(envPath);
  });

  registerHandler('env:check-all-ports', "Check availability of all configured ports", async (_, config: envConfig.EnvConfig) => {
    logger.info('Checking all ports for conflicts...');
    return await envConfig.checkAllPortsAndSuggestAlternatives(config);
  });

  registerHandler('env:find-next-available-port', "Find the next available port starting from a given port", async (_, startPort: number) => {
    logger.info(`Finding next available port starting from ${startPort}...`);
    return await envConfig.findNextAvailablePort(startPort);
  });

  
  // Docker IPC handlers
  registerHandler('docker:start', "Start Docker services", async (_event) => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Starting Docker Desktop...');

    // Send progress updates to renderer
    const progressCallback: docker.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('docker:progress', progress);
      }
    };

    const result = await docker.startDockerDesktop(progressCallback);
    return result;
  });

  registerHandler('docker:wait-ready', "Wait for Docker services to become ready", async (_event) => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Waiting for Docker to be ready...');

    // Send progress updates to renderer
    const progressCallback: docker.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('docker:progress', progress);
      }
    };

    const result = await docker.waitForDockerReady(progressCallback);
    return result;
  });

  registerHandler('docker:start-and-wait', "Start Docker services and wait until ready", async (_event) => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Starting Docker and waiting for it to be ready...');

    // Send progress updates to renderer
    const progressCallback: docker.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('docker:progress', progress);
      }
    };

    const result = await docker.startAndWaitForDocker(progressCallback);
    return result;
  });

  registerHandler('docker:stop', "Stop Docker services", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Stopping Docker Desktop...');
    return await docker.stopDocker();
  });

  registerHandler('docker:restart', "Restart Docker services", async (_event) => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Restarting Docker Desktop...');

    // Send progress updates to renderer
    const progressCallback: docker.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('docker:progress', progress);
      }
    };

    const result = await docker.restartDocker(progressCallback);
    return result;
  });

  registerHandler('docker:health-check', "Run a Docker health check", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Checking Docker health...');
    return await docker.checkDockerHealth();
  });

  registerHandler('docker:containers-status', "Get status of Docker containers", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Getting containers status...');
    return await docker.getContainersStatus();
  });

  // Installation wizard IPC handlers
  registerHandler('wizard:get-instructions', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Getting installation instructions...');
    return installationWizard.getInstallationInstructions();
  });

  registerHandler('wizard:get-download-url', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Getting Docker download URL...');
    return installationWizard.getDockerDownloadUrl();
  });

  registerHandler('wizard:open-download', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Opening Docker download page...');
    return await installationWizard.openDownloadPage();
  });

  registerHandler('wizard:open-git-download', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Opening Git download page...');
    return await installationWizard.openGitDownloadPage();
  });

  registerHandler('wizard:get-git-download-url', "", async () => {
    return installationWizard.getGitDownloadUrl();
  });

  registerHandler('wizard:copy-command', "", async (_, command: string) => {
    logWithCategory('info', LogCategory.PREREQUISITES, `Copying command to clipboard: ${command}`);
    return installationWizard.copyCommandToClipboard(command);
  });

  registerHandler('wizard:get-step', "", async (_, stepNumber: number) => {
    return installationWizard.getStep(stepNumber);
  });

  registerHandler('wizard:get-explanation', "", async () => {
    return installationWizard.getWhyDockerExplanation();
  });

  registerHandler('wizard:get-git-explanation', "", async () => {
    return installationWizard.getWhyGitExplanation();
  });

  registerHandler('wizard:open-nodejs-download', "", async () => {
    logWithCategory('info', LogCategory.PREREQUISITES, 'Opening Node.js download page...');
    return await installationWizard.openNodeJsDownloadPage();
  });

  registerHandler('wizard:get-nodejs-download-url', "", async () => {
    return installationWizard.getNodeJsDownloadUrl();
  });

  registerHandler('wizard:get-nodejs-explanation', "", async () => {
    return installationWizard.getWhyNodeJsExplanation();
  });

  // Client selection IPC handlers
  registerHandler('client:get-options', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'Getting available client options...');
    return clientSelection.getAvailableClients();
  });

  registerHandler('client:save-selection', "", async (_, clients: string[]) => {
    logWithCategory('info', LogCategory.SYSTEM, `Saving client selection: ${clients.join(', ')}`);
    return await clientSelection.saveClientSelection(clients);
  });

  registerHandler('client:get-selection', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'Getting current client selection...');
    return await clientSelection.loadClientSelection();
  });

  registerHandler('client:get-status', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'Getting client status...');
    return await clientSelection.getClientStatus();
  });

  registerHandler('client:clear-selection', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'Clearing client selection...');
    return await clientSelection.clearClientSelection();
  });

  registerHandler('client:get-by-id', "", async (_, clientId: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `Getting client by ID: ${clientId}`);
    return clientSelection.getClientById(clientId);
  });

  registerHandler('client:add-custom', "", async (_, client: clientSelection.ClientMetadata) => {
    logWithCategory('info', LogCategory.SYSTEM, `Adding custom client: ${client.name}`);
    return await clientSelection.addCustomClient(client);
  });

  registerHandler('client:remove-custom', "", async (_, clientId: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `Removing custom client: ${clientId}`);
    return await clientSelection.removeCustomClient(clientId);
  });

  registerHandler('client:update-config', "", async (_, clientId: string, updates: Partial<clientSelection.ClientMetadata>) => {
    logWithCategory('info', LogCategory.SYSTEM, `Updating client config: ${clientId}`);
    return await clientSelection.updateClientConfig(clientId, updates);
  });

  registerHandler('client:get-selection-file-path', "", async () => {
    return clientSelection.getSelectionFilePath();
  });

  registerHandler('client:launch-electron-app', "", async (_, clientId: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `Launching electron app: ${clientId}`);
    return await clientSelection.launchElectronApp(clientId);
  });

  // TypingMind Auto-Configuration IPC handlers
  registerHandler('typingmind:auto-configure', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Auto-configuring TypingMind with MCP Connector...');
    return await typingMindAutoConfig.autoConfigureTypingMind();
  });

  registerHandler('typingmind:set-custom-config', "", async (_event, serverUrl: string, authToken: string) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Setting custom TypingMind configuration...');
    return await typingMindAutoConfig.setCustomTypingMindConfig(serverUrl, authToken);
  });

  registerHandler('typingmind:get-config', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting TypingMind configuration...');
    return await typingMindAutoConfig.loadTypingMindConfig();
  });

  registerHandler('typingmind:get-config-instructions', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting TypingMind configuration instructions...');
    return await typingMindAutoConfig.getConfigurationInstructions();
  });

  registerHandler('typingmind:is-configured', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking if TypingMind is configured...');
    return await typingMindAutoConfig.isTypingMindConfigured();
  });

  registerHandler('typingmind:reset-config', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Resetting TypingMind configuration...');
    return await typingMindAutoConfig.resetTypingMindConfig();
  });

  registerHandler('typingmind:get-mcp-servers-json', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting MCP servers JSON configuration...');
    const serversConfig = await typingMindAutoConfig.buildMCPServersConfig();
    return JSON.stringify(serversConfig, null, 2);
  });

  registerHandler('typingmind:open-window', "", async (_, url: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Opening Typing Mind in browser at ${url}...`);
    try {
      openTypingMindInBrowser(url);
      return { success: true };
    } catch (error) {
      logWithCategory('error', LogCategory.ERROR, 'Failed to open Typing Mind in browser', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Claude Desktop Auto-Configuration IPC handlers
  registerHandler('claude-desktop:auto-configure', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Auto-configuring Claude Desktop...');
    const { autoConfigureClaudeDesktop } = await import('./claude-desktop-auto-config');
    return await autoConfigureClaudeDesktop();
  });

  registerHandler('claude-desktop:is-configured', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking if Claude Desktop is configured...');
    const { isClaudeDesktopConfigured } = await import('./claude-desktop-auto-config');
    return await isClaudeDesktopConfigured();
  });

  registerHandler('claude-desktop:get-config', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting Claude Desktop configuration...');
    const { getClaudeDesktopConfig } = await import('./claude-desktop-auto-config');
    return await getClaudeDesktopConfig();
  });

  registerHandler('claude-desktop:reset-config', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Resetting Claude Desktop configuration...');
    const { resetClaudeDesktopConfig } = await import('./claude-desktop-auto-config');
    return await resetClaudeDesktopConfig();
  });

  registerHandler('claude-desktop:get-config-path', "", () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting Claude Desktop config path...');
    const { getClaudeDesktopConfigPath } = require('./claude-desktop-auto-config');
    return getClaudeDesktopConfigPath();
  });

  registerHandler('claude-desktop:open-config-folder', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Opening Claude Desktop config folder...');
    const { getClaudeDesktopConfigPath } = await import('./claude-desktop-auto-config');
    const configPath = getClaudeDesktopConfigPath();
    await shell.showItemInFolder(configPath);
  });

  registerHandler('claude-desktop:get-config-instructions', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting Claude Desktop configuration instructions...');
    const { getConfigurationInstructions } = await import('./claude-desktop-auto-config');
    return await getConfigurationInstructions();
  });

  // Claude Code CLI IPC handlers
  registerHandler('claude-code:get-status', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting Claude Code CLI status...');
    const { ClaudeCodeDetector } = await import('./claude-code-detector');
    const detector = new ClaudeCodeDetector();
    return await detector.getStatus();
  });

  registerHandler('claude-code:open-install-page', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Opening Claude Code installation page...');
    await shell.openExternal('https://www.anthropic.com/claude-code');
  });

  // Docker Images IPC handlers
  registerHandler('docker-images:load-all', "", async (_event) => {
    logWithCategory('info', LogCategory.DOCKER_IMAGE, 'IPC: Loading all Docker images...');

    // Send progress updates to renderer
    const progressCallback: dockerImages.ImageProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('docker-images:progress', progress);
      }
    };

    const result = await dockerImages.loadAllDockerImages(progressCallback);
    return result;
  });

  registerHandler('docker-images:load-image', "", async (_event, imagePath: string, imageName: string) => {
    logWithCategory('info', LogCategory.DOCKER_IMAGE, `IPC: Loading Docker image ${imageName} from ${imagePath}...`);

    // Send progress updates to renderer
    const progressCallback: dockerImages.ImageProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('docker-images:progress', progress);
      }
    };

    const result = await dockerImages.loadImage(imagePath, imageName, progressCallback);
    return result;
  });

  registerHandler('docker-images:check-exists', "", async (_event, imageName: string) => {
    logWithCategory('info', LogCategory.DOCKER_IMAGE, `IPC: Checking if image exists: ${imageName}`);
    return await dockerImages.checkImageExists(imageName);
  });

  registerHandler('docker-images:list', "", async () => {
    logWithCategory('info', LogCategory.DOCKER_IMAGE, 'IPC: Getting Docker image list...');
    return await dockerImages.getImageList();
  });

  registerHandler('docker-images:get-bundled', "", async () => {
    logWithCategory('info', LogCategory.DOCKER_IMAGE, 'IPC: Getting bundled images information...');
    return await dockerImages.getBundledImages();
  });

  registerHandler('docker-images:check-disk-space', "", async () => {
    logWithCategory('info', LogCategory.DOCKER_IMAGE, 'IPC: Checking disk space...');
    return await dockerImages.checkDiskSpace();
  });

  // MCP System IPC handlers
  registerHandler('mcp-system:start', "", async (_event) => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Starting MCP system...');

    // Send progress updates to renderer
    const progressCallback: mcpSystem.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('mcp-system:progress', progress);
      }
    };

    const result = await mcpSystem.startMCPSystem(progressCallback);
    return result;
  });

  registerHandler('mcp-system:stop', "", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Stopping MCP system...');
    return await mcpSystem.stopMCPSystem();
  });

  registerHandler('mcp-system:restart', "", async (_event) => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Restarting MCP system...');

    // Send progress updates to renderer
    const progressCallback: mcpSystem.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('mcp-system:progress', progress);
      }
    };

    const result = await mcpSystem.restartMCPSystem(progressCallback);
    return result;
  });

  registerHandler('mcp-system:status', "", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Getting MCP system status...');
    return await mcpSystem.getSystemStatus();
  });

  registerHandler('mcp-system:detailed-status', "", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Getting detailed MCP system status...');
    return await mcpSystem.getDetailedServiceStatus();
  });

  registerHandler('mcp-system:urls', "", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Getting service URLs...');
    return await mcpSystem.getServiceUrls();
  });

  registerHandler('mcp-system:logs', "", async (_, serviceName: 'postgres' | 'mcp-writing-servers' | 'mcp-connector', tail?: number) => {
    logWithCategory('info', LogCategory.DOCKER, `IPC: Getting logs for ${serviceName}...`);
    return await mcpSystem.viewServiceLogs(serviceName, tail);
  });

  registerHandler('mcp-system:check-ports', "", async () => {
    logWithCategory('info', LogCategory.DOCKER, 'IPC: Checking port conflicts...');
    return await mcpSystem.checkPortConflicts();
  });

  registerHandler('mcp-system:working-directory', "", async () => {
    return mcpSystem.getMCPWorkingDirectoryPath();
  });

  // Database Backup/Restore IPC handlers
  registerHandler('database-backup:create', "", async (_, customPath?: string, compressed?: boolean) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Creating database backup...');
    return await databaseBackup.createBackup(customPath, compressed);
  });

  registerHandler('database-backup:restore', "", async (_, backupPath: string, dropExisting?: boolean) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Restoring database from ${backupPath}...`);
    return await databaseBackup.restoreBackup(backupPath, dropExisting);
  });

  registerHandler('database-backup:list', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Listing available backups...');
    return await databaseBackup.listBackups();
  });

  registerHandler('database-backup:delete', "", async (_, backupPath: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Deleting backup ${backupPath}...`);
    return await databaseBackup.deleteBackup(backupPath);
  });

  registerHandler('database-backup:select-save-location', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Showing save dialog for backup...');
    return await databaseBackup.selectBackupSaveLocation();
  });

  registerHandler('database-backup:select-restore-file', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Showing open dialog for restore...');
    return await databaseBackup.selectBackupFileForRestore();
  });

  registerHandler('database-backup:get-directory', "", async () => {
    return databaseBackup.getBackupDirectoryPath();
  });

  registerHandler('database-backup:open-directory', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Opening backup directory...');
    return await databaseBackup.openBackupDirectory();
  });

  // Database Administration IPC handlers (MCP database tools)
  registerHandler('database-admin:check-connection', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking database admin server connection...');
    return await databaseAdmin.checkConnection();
  });

  registerHandler('database-admin:get-server-info', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting database server info...');
    return await databaseAdmin.getServerInfo();
  });

  // CRUD Operations
  registerHandler('database-admin:query-records', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Querying records from table ${params.table}...`);
    return await databaseAdmin.queryRecords(params);
  });

  registerHandler('database-admin:insert-record', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Inserting record into table ${params.table}...`);
    return await databaseAdmin.insertRecord(params);
  });

  registerHandler('database-admin:update-records', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Updating records in table ${params.table}...`);
    return await databaseAdmin.updateRecords(params);
  });

  registerHandler('database-admin:delete-records', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Deleting records from table ${params.table}...`);
    return await databaseAdmin.deleteRecords(params);
  });

  // Batch Operations
  registerHandler('database-admin:batch-insert', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Batch inserting ${params.records?.length || 0} records into table ${params.table}...`);
    return await databaseAdmin.batchInsert(params);
  });

  registerHandler('database-admin:batch-update', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Batch updating records in table ${params.table}...`);
    return await databaseAdmin.batchUpdate(params);
  });

  registerHandler('database-admin:batch-delete', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Batch deleting records from table ${params.table}...`);
    return await databaseAdmin.batchDelete(params);
  });

  // Schema Management
  registerHandler('database-admin:get-schema', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Getting schema for table ${params.table}...`);
    return await databaseAdmin.getSchema(params);
  });

  registerHandler('database-admin:list-tables', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Listing database tables...');
    return await databaseAdmin.listTables();
  });

  registerHandler('database-admin:get-relationships', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting table relationships...');
    return await databaseAdmin.getRelationships(params);
  });

  registerHandler('database-admin:list-columns', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Listing columns for table ${params.table}...`);
    return await databaseAdmin.listColumns(params);
  });

  // Audit Functions
  registerHandler('database-admin:query-audit-logs', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Querying audit logs...');
    return await databaseAdmin.queryAuditLogs(params);
  });

  registerHandler('database-admin:get-audit-summary', "", async (_, params: any) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting audit summary...');
    return await databaseAdmin.getAuditSummary(params);
  });

  // Updater IPC handlers
  registerHandler('updater:check-all', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking for all updates...');
    return await updater.checkForAllUpdates();
  });

  registerHandler('updater:check-mcp-servers', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking for MCP servers updates...');
    return await updater.checkForMCPServersUpdate();
  });

  registerHandler('updater:update-all', "", async (_event) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Updating all components...');

    // Send progress updates to renderer
    const progressCallback: updater.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('updater:progress', progress);
      }
    };

    return await updater.updateAll(progressCallback);
  });

  registerHandler('updater:update-mcp-servers', "", async (_event) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Updating MCP servers...');

    // Send progress updates to renderer
    const progressCallback: updater.ProgressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('updater:progress', progress);
      }
    };

    return await updater.updateMCPServers(progressCallback);
  });

  registerHandler('updater:get-preferences', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting update preferences...');
    return await updater.getUpdatePreferences();
  });

  registerHandler('updater:set-preferences', "", async (_, prefs: updater.UpdatePreferences) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Setting update preferences...');
    return await updater.setUpdatePreferences(prefs);
  });

  // App Settings IPC handlers (issue #181 -- configured current-user identity)
  registerHandler('app-settings:get-current-user', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting current user setting...');
    return await appSettings.getCurrentUser();
  });

  registerHandler('app-settings:set-current-user', "", async (_, user: CurrentUserSetting) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Setting current user identity...');
    return await appSettings.setCurrentUser(user);
  });

  // Setup Wizard IPC handlers
  registerHandler('setup-wizard:is-first-run', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking if first run...');
    return await setupWizard.isFirstRun();
  });

  registerHandler('setup-wizard:get-state', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting wizard state...');
    return await setupWizard.getWizardState();
  });

  registerHandler('setup-wizard:save-state', "", async (_, step: setupWizard.WizardStep, data?: Partial<setupWizard.WizardStepData>) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Saving wizard state for step ${step}...`);
    return await setupWizard.saveWizardState(step, data);
  });

  registerHandler('setup-wizard:complete-step', "", async (_, step: setupWizard.WizardStep, data?: Partial<setupWizard.WizardStepData>) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Completing wizard step ${step}...`);
    return await setupWizard.completeStep(step, data);
  });

  registerHandler('setup-wizard:go-to-step', "", async (_, step: setupWizard.WizardStep) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Navigating to wizard step ${step}...`);
    return await setupWizard.goToStep(step);
  });

  registerHandler('setup-wizard:mark-complete', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Marking wizard as complete...');
    const result = await setupWizard.markWizardComplete();

    // Close the wizard window and open the dashboard
    if (mainWindow) {
      logWithCategory('info', LogCategory.SYSTEM, 'Closing wizard and opening dashboard...');

      // Create the dashboard window BEFORE closing the wizard to prevent app.quit()
      const wizardWindow = mainWindow;
      mainWindow = null; // Clear reference so createWindow() can create new one

      createWindow(); // Create dashboard immediately

      // Close wizard after dashboard is created
      setTimeout(() => {
        wizardWindow.close();
      }, 100);
    }

    return result;
  });

  registerHandler('setup-wizard:reset', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Resetting wizard...');
    return await setupWizard.resetWizard();
  });

  registerHandler('setup-wizard:get-progress', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting wizard progress...');
    return await setupWizard.getWizardProgress();
  });

  registerHandler('setup-wizard:is-step-completed', "", async (_, step: setupWizard.WizardStep) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Checking if step ${step} is completed...`);
    return await setupWizard.isStepCompleted(step);
  });

  registerHandler('setup-wizard:get-step-name', "", async (_, step: setupWizard.WizardStep) => {
    return setupWizard.getStepName(step);
  });

  registerHandler('setup-wizard:get-step-description', "", async (_, step: setupWizard.WizardStep) => {
    return setupWizard.getStepDescription(step);
  });

  registerHandler('setup-wizard:can-proceed', "", async (_, step: setupWizard.WizardStep) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Checking if can proceed from step ${step}...`);
    return await setupWizard.canProceedToNextStep(step);
  });

  registerHandler('setup-wizard:get-installation-version', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting installation version...');
    return await setupWizard.getInstallationVersion();
  });

  registerHandler('setup-wizard:is-installation-outdated', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking if installation is outdated...');
    return await setupWizard.isInstallationOutdated();
  });

  registerHandler('setup-wizard:get-migration-history', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting migration history...');
    return await setupWizard.getMigrationHistory();
  });

  registerHandler('setup-wizard:add-migration-record', "", async (_, record: setupWizard.MigrationRecord) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Adding migration record for version ${record.version}...`);
    return await setupWizard.addMigrationRecord(record);
  });

  // Migration IPC handlers
  registerHandler('migrations:check-pending', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Checking for pending migrations...');
    return await migrations.checkForPendingMigrations();
  });

  registerHandler('migrations:run', "", async (_, migrationsToRun: migrations.Migration[]) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Running ${migrationsToRun.length} migrations...`);
    return await migrations.runMigrations(migrationsToRun);
  });

  registerHandler('migrations:get-all', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting all registered migrations...');
    return migrations.getAllMigrations();
  });

  registerHandler('migrations:get-for-upgrade', "", async (_, fromVersion: string, toVersion: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Getting migrations for upgrade ${fromVersion} -> ${toVersion}...`);
    return migrations.getMigrationsForUpgrade(fromVersion, toVersion);
  });

  registerHandler('migrations:get-steps-to-rerun', "", async (_, pendingMigrations: migrations.Migration[]) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting steps to rerun for pending migrations...');
    return migrations.getStepsToRerunForMigrations(pendingMigrations);
  });

  registerHandler('migrations:validate', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Validating migration registry...');
    return migrations.validateMigrations();
  });

  // Migration Wizard IPC handlers
  registerHandler('migrations:complete', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Migration wizard completed, transitioning to main app...');

    // Close the current migration wizard window
    if (mainWindow) {
      mainWindow.close();
      mainWindow = null;
    }

    // Create the main application window
    createWindow();

    return { success: true };
  });

  registerHandler('closeWindow', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Closing current window...');

    if (mainWindow) {
      mainWindow.close();
    }

    return { success: true };
  });

  // GitHub Credentials IPC handlers
  registerHandler('github-credentials:set-token', "", async (_, token: string) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Setting GitHub token...');
    const { getGitHubCredentialManager } = await import('./github-credential-manager');
    getGitHubCredentialManager(token);
    return { success: true };
  });

  registerHandler('github-credentials:get-status', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Getting GitHub credentials status...');
    const { getGitHubCredentialManager } = await import('./github-credential-manager');
    const credentialManager = getGitHubCredentialManager();
    return {
      configured: credentialManager.isConfigured(),
    };
  });

  registerHandler('github-credentials:test-token', "", async (_, token?: string) => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Testing GitHub token...');
    const { getGitHubCredentialManager } = await import('./github-credential-manager');
    const credentialManager = getGitHubCredentialManager();
    return await credentialManager.testTokenValidity(token);
  });

  registerHandler('github-credentials:validate-token-format', "", async (_, token: string) => {
    const { GitHubCredentialManager } = await import('./github-credential-manager');
    return GitHubCredentialManager.validateTokenFormat(token);
  });

  registerHandler('github-credentials:clear-token', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Clearing GitHub token...');
    const { getGitHubCredentialManager } = await import('./github-credential-manager');
    const credentialManager = getGitHubCredentialManager();
    credentialManager.clearToken();
    return { success: true };
  });

  // ========================================
  // Repository IPC Handlers
  // ========================================

  /**
   * Clone a Git repository with progress tracking
   */
  registerHandler(IPC_CHANNELS.REPOSITORY.CLONE, "",
    async (_event, request: RepositoryCloneRequest): Promise<RepositoryCloneResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Cloning repository ${request.url} to ${request.targetPath}`);

      try {
        // Create progress throttler (max 10 events per second)
        const progressThrottler = new ProgressThrottler(10);

        // Wrap the progress callback with throttling
        const throttledOptions = {
          ...request.options,
          onProgress: request.options?.onProgress
            ? (progress: any) => {
                progressThrottler.emit(progress, (throttledProgress) => {
                  if (mainWindow) {
                    mainWindow.webContents.send(IPC_CHANNELS.REPOSITORY.PROGRESS, throttledProgress);
                  }
                });
              }
            : undefined,
        };

        await repositoryManager.cloneRepository(request.url, request.targetPath, throttledOptions);

        // Flush any pending progress
        if (throttledOptions.onProgress) {
          progressThrottler.flush((finalProgress) => {
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.REPOSITORY.PROGRESS, finalProgress);
            }
          });
        }

        return {
          success: true,
          message: 'Repository cloned successfully',
          path: request.targetPath,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error cloning repository', error);
        return {
          success: false,
          message: 'Failed to clone repository',
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Checkout a specific version (branch, tag, or commit)
   */
  registerHandler(IPC_CHANNELS.REPOSITORY.CHECKOUT_VERSION, "",
    async (_event, request: RepositoryCheckoutRequest): Promise<RepositoryCheckoutResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Checking out version ${request.version} in ${request.repoPath}`);

      try {
        await repositoryManager.checkoutVersion(request.repoPath, request.version);

        return {
          success: true,
          message: `Checked out ${request.version}`,
          version: request.version,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error checking out version', error);
        return {
          success: false,
          message: 'Failed to checkout version',
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Get repository status
   */
  registerHandler(IPC_CHANNELS.REPOSITORY.GET_STATUS, "",
    async (_event, request: RepositoryStatusRequest): Promise<RepositoryStatusResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Getting repository status for ${request.repoPath}`);

      try {
        const status = await repositoryManager.getRepoStatus(request.repoPath);

        return {
          success: true,
          status,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error getting repository status', error);
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Get current branch name
   */
  registerHandler(IPC_CHANNELS.REPOSITORY.GET_CURRENT_BRANCH, "",
    async (_event, request: RepositoryBranchRequest): Promise<RepositoryBranchResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Getting current branch for ${request.repoPath}`);

      try {
        const status = await repositoryManager.getRepoStatus(request.repoPath);

        if (!status.isGitRepo) {
          return {
            success: false,
            error: 'Not a Git repository',
          };
        }

        return {
          success: true,
          branch: status.currentBranch,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error getting current branch', error);
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * List all branches in repository
   */
  registerHandler(IPC_CHANNELS.REPOSITORY.LIST_BRANCHES, "",
    async (_event, request: RepositoryBranchRequest): Promise<RepositoryBranchResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Listing branches for ${request.repoPath}`);

      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execPromise = promisify(exec);

        const { stdout } = await execPromise('git branch -a', {
          cwd: request.repoPath,
          timeout: 10000,
        });

        const branches = stdout
          .split('\n')
          .map((line: string) => line.trim().replace(/^\*\s+/, '').replace(/^remotes\/origin\//, ''))
          .filter((line: string) => line.length > 0 && !line.includes('HEAD ->'));

        // Remove duplicates
        const uniqueBranches = Array.from(new Set(branches)) as string[];

        return {
          success: true,
          branches: uniqueBranches,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error listing branches', error);
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Get latest commit information
   */
  registerHandler(IPC_CHANNELS.REPOSITORY.GET_LATEST_COMMIT, "",
    async (_event, request: RepositoryCommitRequest): Promise<RepositoryCommitResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Getting latest commit for ${request.repoPath}`);

      try {
        const status = await repositoryManager.getRepoStatus(request.repoPath);

        if (!status.isGitRepo) {
          return {
            success: false,
            error: 'Not a Git repository',
          };
        }

        return {
          success: true,
          commit: status.latestCommit,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error getting latest commit', error);
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Cancel ongoing repository operation
   */
  registerHandler(IPC_CHANNELS.REPOSITORY.CANCEL, "",
    async (): Promise<RepositoryCancelResponse> => {
      logWithCategory('info', LogCategory.GENERAL, 'IPC: Cancelling repository operation');

      try {
        const cancelled = await repositoryManager.cancelOperation();

        return {
          success: cancelled,
          message: cancelled ? 'Operation cancelled' : 'No operation to cancel',
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error cancelling operation', error);
        return {
          success: false,
          message: error.message || String(error),
        };
      }
    }
  );

  // ========================================
  // Build IPC Handlers
  // ========================================

  /**
   * Execute npm install
   */
  registerHandler(IPC_CHANNELS.BUILD.NPM_INSTALL, "",
    async (_event, request: BuildNpmInstallRequest): Promise<BuildNpmInstallResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Running npm install in ${request.repoPath}`);

      try {
        // Create progress throttler (max 10 events per second)
        const progressThrottler = new ProgressThrottler(10);

        const buildOrchestrator = createBuildOrchestrator((progress) => {
          progressThrottler.emit(progress, (throttledProgress) => {
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, throttledProgress);
            }
          });
        });

        await buildOrchestrator.npmInstall(request.repoPath, request.options);

        // Flush any pending progress
        progressThrottler.flush((finalProgress) => {
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, finalProgress);
          }
        });

        return {
          success: true,
          message: 'npm install completed successfully',
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error running npm install', error);
        return {
          success: false,
          message: 'npm install failed',
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Execute npm build
   */
  registerHandler(IPC_CHANNELS.BUILD.NPM_BUILD, "",
    async (_event, request: BuildNpmBuildRequest): Promise<BuildNpmBuildResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Running npm build in ${request.repoPath}`);

      try {
        // Create progress throttler (max 10 events per second)
        const progressThrottler = new ProgressThrottler(10);

        const buildOrchestrator = createBuildOrchestrator((progress) => {
          progressThrottler.emit(progress, (throttledProgress) => {
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, throttledProgress);
            }
          });
        });

        await buildOrchestrator.npmBuild(request.repoPath, request.buildScript, request.options);

        // Flush any pending progress
        progressThrottler.flush((finalProgress) => {
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, finalProgress);
          }
        });

        return {
          success: true,
          message: 'npm build completed successfully',
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error running npm build', error);
        return {
          success: false,
          message: 'npm build failed',
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Execute docker build
   */
  registerHandler(IPC_CHANNELS.BUILD.DOCKER_BUILD, "",
    async (_event, request: BuildDockerBuildRequest): Promise<BuildDockerBuildResponse> => {
      logWithCategory('info', LogCategory.DOCKER, `IPC: Building Docker image ${request.imageName}`);

      try {
        // Create progress throttler (max 10 events per second)
        const progressThrottler = new ProgressThrottler(10);

        const buildOrchestrator = createBuildOrchestrator((progress) => {
          progressThrottler.emit(progress, (throttledProgress) => {
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, throttledProgress);
            }
          });
        });

        await buildOrchestrator.dockerBuild(request.dockerfile, request.imageName, request.options);

        // Flush any pending progress
        progressThrottler.flush((finalProgress) => {
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, finalProgress);
          }
        });

        return {
          success: true,
          message: 'Docker build completed successfully',
          imageName: request.imageName,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.DOCKER, 'Error running docker build', error);
        return {
          success: false,
          message: 'Docker build failed',
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Execute build chain
   */
  registerHandler(IPC_CHANNELS.BUILD.EXECUTE_CHAIN, "",
    async (_event, request: BuildExecuteChainRequest): Promise<BuildExecuteChainResponse> => {
      logWithCategory('info', LogCategory.GENERAL, `IPC: Executing build chain with ${request.steps.length} steps`);

      try {
        // Create progress throttler (max 10 events per second)
        const progressThrottler = new ProgressThrottler(10);

        const buildOrchestrator = createBuildOrchestrator((progress) => {
          progressThrottler.emit(progress, (throttledProgress) => {
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, throttledProgress);
            }
          });
        });

        const result = await buildOrchestrator.executeBuildChain(request.steps, request.config);

        // Flush any pending progress
        progressThrottler.flush((finalProgress) => {
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, finalProgress);
          }
        });

        return {
          success: result.success,
          result,
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error executing build chain', error);
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Execute custom script
   */
  registerHandler(IPC_CHANNELS.BUILD.EXECUTE_CUSTOM_SCRIPT, "",
    async (_event, request: BuildExecuteCustomScriptRequest): Promise<BuildExecuteCustomScriptResponse> => {
      logWithCategory('info', LogCategory.SCRIPT, `IPC: Executing custom script: ${request.command}`);

      try {
        // Create progress throttler (max 10 events per second)
        const progressThrottler = new ProgressThrottler(10);

        const buildOrchestrator = createBuildOrchestrator((progress) => {
          progressThrottler.emit(progress, (throttledProgress) => {
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, throttledProgress);
            }
          });
        });

        await buildOrchestrator.executeCustomScript(request.command, request.options);

        // Flush any pending progress
        progressThrottler.flush((finalProgress) => {
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.BUILD.PROGRESS, finalProgress);
          }
        });

        return {
          success: true,
          message: 'Custom script executed successfully',
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.SCRIPT, 'Error executing custom script', error);
        return {
          success: false,
          message: 'Custom script execution failed',
          error: error.message || String(error),
        };
      }
    }
  );

  /**
   * Cancel ongoing build operation
   */
  registerHandler(IPC_CHANNELS.BUILD.CANCEL, "",
    async (): Promise<BuildCancelResponse> => {
      logWithCategory('info', LogCategory.GENERAL, 'IPC: Cancelling build operation');

      try {
        const buildOrchestrator = createBuildOrchestrator();
        buildOrchestrator.cancel();

        return {
          success: true,
          message: 'Build operation cancelled',
        };
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error cancelling build operation', error);
        return {
          success: false,
          message: error.message || String(error),
        };
      }
    }
  );

  // ====================
  // Pipeline IPC Handlers
  // ====================

  let currentPipelineOrchestrator: ReturnType<typeof createBuildPipelineOrchestrator> | null = null;

  /**
   * Execute build pipeline
   */
  registerHandler(IPC_CHANNELS.PIPELINE.EXECUTE, "",
    async (_event, request: PipelineExecuteRequest): Promise<PipelineExecuteResponse> => {
      logWithCategory('info', LogCategory.GENERAL, 'IPC: Executing build pipeline', { configPath: request.configPath });

      try {
        // Create new pipeline orchestrator
        currentPipelineOrchestrator = createBuildPipelineOrchestrator();

        // Resolve and load configuration
        const resolvedConfigPath = resolveConfigPath(request.configPath);
        logWithCategory('info', LogCategory.GENERAL, 'Resolved config path', { resolvedConfigPath });
        await currentPipelineOrchestrator.loadConfig(resolvedConfigPath);

        // Ensure workingDirectory is set to userData if not provided
        // This ensures repositories are cloned to {userData}/repositories/
        // where Docker Compose expects them for volume mounts (via environment variables)
        const options = request.options || {};
        if (!options.workingDirectory) {
          options.workingDirectory = mcpSystem.getMCPWorkingDirectory();
          logWithCategory('info', LogCategory.GENERAL, 'Using userData as working directory', { workingDirectory: options.workingDirectory });
        }

        // Create progress throttler
        const progressThrottler = new ProgressThrottler(10);

        // Execute pipeline with progress tracking
        const result = await currentPipelineOrchestrator.executePipeline(
          options,
          (progress) => {
            progressThrottler.emit(progress, (throttledProgress) => {
              if (mainWindow) {
                mainWindow.webContents.send(IPC_CHANNELS.PIPELINE.PROGRESS, throttledProgress);
              }
            });
          }
        );

        // Flush any pending progress
        progressThrottler.flush((finalProgress) => {
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.PIPELINE.PROGRESS, finalProgress);
          }
        });

        return {
          success: result.success,
          message: result.message,
          result: {
            phase: result.phase,
            clonedRepositories: result.clonedRepositories,
            builtRepositories: result.builtRepositories,
            dockerImages: result.dockerImages,
            verifiedArtifacts: result.verifiedArtifacts,
            errors: result.errors,
            duration: result.duration,
          },
        };
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        logWithCategory('error', LogCategory.GENERAL, 'Error executing build pipeline', { message: errorMessage, stack: errorStack });

        // Log additional context
        if (error.code) {
          logWithCategory('error', LogCategory.GENERAL, `Error code: ${error.code}`);
        }

        return {
          success: false,
          message: 'Build pipeline execution failed',
          error: errorMessage,
        };
      } finally {
        currentPipelineOrchestrator = null;
      }
    }
  );

  /**
   * Cancel ongoing pipeline operation
   */
  registerHandler(IPC_CHANNELS.PIPELINE.CANCEL, "",
    async (): Promise<PipelineCancelResponse> => {
      logWithCategory('info', LogCategory.GENERAL, 'IPC: Cancelling pipeline operation');

      try {
        if (currentPipelineOrchestrator) {
          await currentPipelineOrchestrator.cancel();
          return {
            success: true,
            message: 'Pipeline operation cancelled',
          };
        } else {
          return {
            success: false,
            message: 'No active pipeline operation to cancel',
          };
        }
      } catch (error: any) {
        logWithCategory('error', LogCategory.ERROR, 'Error cancelling pipeline operation', error);
        return {
          success: false,
          message: error.message || String(error),
        };
      }
    }
  );

  /**
   * Get current pipeline status
   */
  registerHandler(IPC_CHANNELS.PIPELINE.GET_STATUS, "",
    async (): Promise<PipelineStatusResponse> => {
      try {
        if (currentPipelineOrchestrator) {
          const phase = currentPipelineOrchestrator.getCurrentPhase();
          return {
            success: true,
            phase,
            message: `Pipeline is in ${phase} phase`,
          };
        } else {
          return {
            success: true,
            phase: 'idle',
            message: 'No active pipeline',
          };
        }
      } catch (error: any) {
        return {
          success: false,
          phase: 'error',
          message: error.message || String(error),
        };
      }
    }
  );

  // ============================================================================
  // Plugin Management IPC Handlers
  // ============================================================================

  registerHandler('plugins:get-all', "", async () => {
    try {
      return {
        success: true,
        plugins: pluginManager.getAllPlugins(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Alias for plugins:get-all (for backwards compatibility with 'plugin:list')
  registerHandler('plugin:list', "", async () => {
    try {
      const plugins = pluginManager.getAllPlugins();
      // Sanitize plugin data - only return serializable fields
      return plugins.map(plugin => ({
        id: plugin.id,
        manifest: plugin.manifest,
        status: plugin.status,
        error: plugin.error,
        // Don't include 'instance' or 'context' as they contain non-serializable functions
      }));
    } catch (error: any) {
      logger.error('Error getting plugin list:', error);
      return [];
    }
  });

  registerHandler('plugins:get-statistics', "", async () => {
    try {
      return {
        success: true,
        statistics: pluginManager.getStatistics(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  registerHandler('plugins:activate', "", async (_event, pluginId: string) => {
    try {
      await pluginManager.activatePlugin(pluginId);
      return {
        success: true,
        message: `Plugin ${pluginId} activated`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  registerHandler('plugins:deactivate', "", async (_event, pluginId: string) => {
    try {
      await pluginManager.deactivatePlugin(pluginId);
      return {
        success: true,
        message: `Plugin ${pluginId} deactivated`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  registerHandler('plugins:reload', "", async (_event, pluginId: string) => {
    try {
      await pluginManager.reloadPlugin(pluginId);
      return {
        success: true,
        message: `Plugin ${pluginId} reloaded`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Plugin View IPC handlers
  // NEW: Get plugin view URL for embedding in main window
  registerHandler('plugin:get-view-url', "", async (_event, pluginId: string, viewName: string) => {
    try {
      logWithCategory('info', LogCategory.SYSTEM, `IPC: Getting plugin view URL ${pluginId}:${viewName}`);

      const pluginRegistry = pluginManager.getRegistry();
      const plugin = pluginRegistry?.getPlugin(pluginId);

      if (!plugin) {
        const error = `Plugin ${pluginId} not found`;
        logWithCategory('error', LogCategory.SYSTEM, error);
        throw new Error(error);
      }

      // Get plugin view path
      const pluginDir = plugin.context.plugin.installPath;
      const viewPath = path.join(pluginDir, 'dist', 'renderer', 'index.html');

      logWithCategory('debug', LogCategory.SYSTEM, `Plugin directory: ${pluginDir}`);
      logWithCategory('debug', LogCategory.SYSTEM, `View path: ${viewPath}`);

      // Check if file exists
      if (!fs.existsSync(viewPath)) {
        const error = `Plugin renderer not found at: ${viewPath}`;
        logWithCategory('error', LogCategory.SYSTEM, error);
        throw new Error(error);
      }

      const result = {
        pluginId,
        viewName,
        url: viewPath,
        metadata: {
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          description: plugin.manifest.description,
        },
      };

      logWithCategory('info', LogCategory.SYSTEM, `Plugin view URL retrieved successfully: ${pluginId}:${viewName}`);
      return result;
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to get plugin view URL: ${error.message}`);
      logWithCategory('error', LogCategory.SYSTEM, `Error stack: ${error.stack}`);
      throw error;
    }
  });

  // DEPRECATED: Old plugin:show-view handler (kept for backward compatibility)
  registerHandler('plugin:show-view', "", async (_event, pluginId: string, viewName: string) => {
    try {
      logWithCategory('warn', LogCategory.SYSTEM, `[DEPRECATED] plugin:show-view called - use ViewRouter instead`);
      logWithCategory('info', LogCategory.SYSTEM, `IPC: Showing plugin view ${pluginId}:${viewName}`);

      const pluginRegistry = pluginManager.getRegistry();
      const plugin = pluginRegistry?.getPlugin(pluginId);

      if (!plugin) {
        const error = `Plugin ${pluginId} not found`;
        logWithCategory('error', LogCategory.SYSTEM, error);
        throw new Error(error);
      }

      // Get plugin view path
      const pluginDir = plugin.context.plugin.installPath;
      const viewPath = path.join(pluginDir, 'dist', 'renderer', 'index.html');

      logWithCategory('debug', LogCategory.SYSTEM, `Plugin directory: ${pluginDir}`);
      logWithCategory('debug', LogCategory.SYSTEM, `View path: ${viewPath}`);

      // Check if file exists
      if (!fs.existsSync(viewPath)) {
        const error = `Plugin renderer not found at: ${viewPath}`;
        logWithCategory('error', LogCategory.SYSTEM, error);
        throw new Error(error);
      }

      await pluginViewManager.showPluginView({
        pluginId,
        viewName,
        url: viewPath,
      });

      logWithCategory('info', LogCategory.SYSTEM, `Plugin view shown successfully: ${pluginId}:${viewName}`);
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to show plugin view: ${error.message}`);
      logWithCategory('error', LogCategory.SYSTEM, `Error stack: ${error.stack}`);
      throw error;
    }
  });

  registerHandler('plugin:hide-view', "", (_event, pluginId: string, viewName: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Hiding plugin view ${pluginId}:${viewName}`);
    pluginViewManager.hidePluginView(pluginId, viewName);
  });

  registerHandler('plugin:close-view', "", (_event, pluginId: string, viewName: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Closing plugin view ${pluginId}:${viewName}`);
    pluginViewManager.closePluginView(pluginId, viewName);
  });

  // ========================================
  // Project and Series Management IPC Handlers
  // ========================================

  // Project handlers
  registerHandler('project:create', "Create a new project", async (_event, data: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Creating project: ${data.name}`);
    try {
      const { ProjectManager } = await import('./project-manager');
      const projectManager = new ProjectManager();
      return await projectManager.createProject(data);
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to create project: ${error.message}`);
      throw error;
    }
  });

  registerHandler('project:list', "List all projects", async () => {
    logWithCategory('debug', LogCategory.SYSTEM, 'IPC: Listing projects');
    try {
      const { ProjectManager } = await import('./project-manager');
      const projectManager = new ProjectManager();
      return await projectManager.listProjects();
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to list projects: ${error.message}`);
      throw error;
    }
  });

  registerHandler('project:get', "Get a project by id", async (_event, id: number) => {
    logWithCategory('debug', LogCategory.SYSTEM, `IPC: Getting project ${id}`);
    try {
      const { ProjectManager } = await import('./project-manager');
      const projectManager = new ProjectManager();
      return await projectManager.getProject(id);
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to get project: ${error.message}`);
      throw error;
    }
  });

  registerHandler('project:update', "Update a project", async (_event, id: number, data: any) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Updating project ${id}`);
    try {
      const { ProjectManager } = await import('./project-manager');
      const projectManager = new ProjectManager();
      await projectManager.updateProject(id, data);
      return { success: true };
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to update project: ${error.message}`);
      throw error;
    }
  });

  registerHandler('project:delete', "Delete a project", async (_event, id: number) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Deleting project ${id}`);
    try {
      const { ProjectManager } = await import('./project-manager');
      const projectManager = new ProjectManager();
      await projectManager.deleteProject(id);
      return { success: true };
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to delete project: ${error.message}`);
      throw error;
    }
  });

  // Initialize workspace structure with optional genre pack
  registerHandler('project:initialize-workspace', "Initialize a project's workspace folder structure", async (_event, options: {
    folderPath: string;
    projectName: string;
    genrePack?: string;
  }) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Initializing workspace at ${options.folderPath}`);
    try {
      const { folderPath, projectName, genrePack } = options;

      // Create standard directories. This mirrors the Series Architect v2
      // workflow layout (FictIonLab-Downloads: outputs/ + series-planning/),
      // not the earlier tiered planning/ proposal -- see issue #165. Per-book
      // artifacts are NOT scaffolded here; SA v2 creates outputs/book_N/ at
      // runtime (dramatica-storyform/workflow.yaml, series-architect-development
      // /workflow.yaml), one folder per book, so book N+1 never touches book N.
      await fse.ensureDir(path.join(folderPath, '.claude'));
      await fse.ensureDir(path.join(folderPath, 'outputs'));
      await fse.ensureDir(path.join(folderPath, 'series-planning'));

      // Create settings.json. Genre packs are copied to the project folder
      // when a workflow runs, via the ResourceCopier in
      // fictionlab-workflow/packages/workflow-runner (keyed by pack id --
      // see #159/genre-pack-handlers.ts's GenrePack.id shape). We don't copy
      // pack contents here at project-creation time, but we DO persist the
      // selected id into settings.json so that later run knows which pack to
      // copy instead of silently defaulting to none. The key is `genrePack`,
      // matching the id field the run-time consumers already use
      // (ResourceCopyOptions.genrePack / workflow-executor's
      // initialVariables.genrePack).
      const projectSettings: {
        name: string;
        projectType: string;
        createdAt: string;
        genrePack?: string;
      } = {
        name: projectName,
        projectType: 'fiction-series',
        createdAt: new Date().toISOString()
      };
      if (genrePack && genrePack !== 'none') {
        projectSettings.genrePack = genrePack;
        logWithCategory('info', LogCategory.SYSTEM, `Genre pack '${genrePack}' recorded in project settings; will be copied when workflow runs`);
      }
      await fse.writeJson(path.join(folderPath, '.claude', 'settings.json'), projectSettings, { spaces: 2 });

      // Copy CLAUDE.md template for workflow resumption support
      const templatePath = app.isPackaged
        ? path.join(process.resourcesPath, 'resources', 'templates', 'project-init', 'CLAUDE.md')
        : path.join(__dirname, '..', '..', 'resources', 'templates', 'project-init', 'CLAUDE.md');

      if (await fse.pathExists(templatePath)) {
        await fse.copy(templatePath, path.join(folderPath, '.claude', 'CLAUDE.md'));
        logWithCategory('info', LogCategory.SYSTEM, 'Copied CLAUDE.md template to project');
      } else {
        logWithCategory('warn', LogCategory.SYSTEM, `CLAUDE.md template not found at ${templatePath}`);
      }

      // Drop a README describing the scaffold + the per-book isolation rule
      // (outputs/book_N/ per book; book N+1 must never write into book N's folder).
      const readmePath = path.join(folderPath, 'README.md');
      if (!(await fse.pathExists(readmePath))) {
        await fse.writeFile(readmePath, buildProjectReadme(projectName), 'utf8');
        logWithCategory('info', LogCategory.SYSTEM, 'Wrote project README.md');
      }

      logWithCategory('info', LogCategory.SYSTEM, `Workspace initialized at ${folderPath}`);
      return { success: true };
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to initialize workspace: ${error.message}`);
      throw error;
    }
  });

  // List available genre packs
  // Registered separately via registerGenrePackHandlers() -- see
  // ./handlers/genre-pack-handlers.ts. Genre packs live with the workflow
  // plugin's bundled resources (fictionlab-workflow/resources/genre-packs),
  // not inside this app; the handler resolves them via the workflow
  // plugin's own ResourceCopier at {userData}/plugins/fictionlab-workflow.

  // ========================================
  // Provider Management Handlers
  // ========================================

  // List all saved providers
  registerHandler('provider:list', "", async () => {
    try {
      const providerManager = getProviderManager();
      await providerManager.initialize();
      const providers = await providerManager.listSavedProviders();
      return providers;
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `Failed to list providers: ${error.message}`);
      return { error: error.message };
    }
  });

  // Add new provider
  registerHandler('provider:add', "", async (_event, provider: LLMProviderConfig) => {
    try {
      const providerManager = getProviderManager();
      await providerManager.initialize();
      const id = await providerManager.saveProvider(provider);
      return { success: true, id };
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `Failed to add provider: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // Update existing provider
  registerHandler('provider:update', "", async (_event, id: string, provider: LLMProviderConfig) => {
    try {
      const providerManager = getProviderManager();
      await providerManager.initialize();
      const updatedProvider = { ...provider, id };
      await providerManager.saveProvider(updatedProvider);
      return { success: true };
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `Failed to update provider: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // Delete provider
  registerHandler('provider:delete', "", async (_event, id: string) => {
    try {
      const providerManager = getProviderManager();
      await providerManager.initialize();
      await providerManager.deleteProvider(id);
      return { success: true };
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `Failed to delete provider: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // Test provider credentials
  registerHandler('provider:test', "", async (_event, provider: LLMProviderConfig) => {
    try {
      const providerManager = getProviderManager();
      await providerManager.initialize();
      const result = await providerManager.validateProvider(provider);
      return result;
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `Provider test failed: ${error.message}`);
      return { valid: false, error: error.message };
    }
  });

  // Get all available LLM providers (for workflow node configuration)
  registerHandler('llm-providers:get-all', "", async () => {
    try {
      const providerManager = getProviderManager();
      await providerManager.initialize();

      // Get saved providers from credential store
      const savedProviders = await providerManager.listSavedProviders();

      // If no saved providers, return a default Claude Code CLI provider
      if (!savedProviders || savedProviders.length === 0) {
        logWithCategory('info', LogCategory.WORKFLOW, 'No saved providers, returning default Claude Code CLI');
        return [{
          id: 'default-claude-code-cli',
          type: 'claude-code-cli',
          name: 'Claude Code (Default)',
          enabled: true,
          config: {
            model: 'default',
            headless: true,
            outputFormat: 'text'
          }
        }];
      }

      return savedProviders;
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `Failed to get LLM providers: ${error.message}`);
      // Return default provider even on error
      return [{
        id: 'default-claude-code-cli',
        type: 'claude-code-cli',
        name: 'Claude Code (Default)',
        enabled: true,
        config: {
          model: 'claude-sonnet-4-5',
          headless: true,
          outputFormat: 'text'
        }
      }];
    }
  });

  // ========================================
  // File Browser Handlers
  // ========================================

  // Open file picker dialog
  registerHandler('dialog:open-file', "", async (_event, options?: { defaultPath?: string }) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        defaultPath: options?.defaultPath,
      });

      if (result.canceled) {
        return { canceled: true };
      }

      return { canceled: false, filePath: result.filePaths[0] };
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `File dialog error: ${error.message}`);
      return { error: error.message };
    }
  });

  // Open folder picker dialog
  registerHandler('dialog:open-folder', "", async (_event, options?: { defaultPath?: string }) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: options?.defaultPath,
      });

      if (result.canceled) {
        return { canceled: true };
      }

      return { canceled: false, folderPath: result.filePaths[0] };
    } catch (error: any) {
      logWithCategory('error', LogCategory.WORKFLOW, `Folder dialog error: ${error.message}`);
      return { error: error.message };
    }
  });

  // Shell operations
  registerHandler('shell:open-path', "", async (_event, path: string) => {
    logWithCategory('info', LogCategory.SYSTEM, `IPC: Opening path: ${path}`);
    try {
      const result = await shell.openPath(path);
      if (result) {
        // openPath returns empty string on success, error message on failure
        logWithCategory('error', LogCategory.SYSTEM, `Failed to open path: ${result}`);
        throw new Error(result);
      }
      return { success: true };
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to open path: ${error.message}`);
      throw error;
    }
  });

  // Automated Claude Code CLI installation
  registerHandler('claude:install-cli', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Installing Claude Code CLI');
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Install via npm globally
      logWithCategory('info', LogCategory.SYSTEM, 'Running: npm install -g @anthropic-ai/claude-code');

      const { stdout, stderr } = await execAsync('npm install -g @anthropic-ai/claude-code', {
        timeout: 120000 // 2 minutes timeout
      });

      logWithCategory('info', LogCategory.SYSTEM, `Installation output: ${stdout}`);

      if (stderr && !stderr.includes('npm WARN')) {
        logWithCategory('warn', LogCategory.SYSTEM, `Installation warnings: ${stderr}`);
      }

      return { success: true, message: 'Claude Code CLI installed successfully' };
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to install Claude Code CLI: ${error.message}`);
      return {
        success: false,
        error: error.message || 'Installation failed. Make sure npm is installed and you have an internet connection.'
      };
    }
  });

  // Automated Claude Code authentication
  registerHandler('claude:authenticate', "", async () => {
    logWithCategory('info', LogCategory.SYSTEM, 'IPC: Authenticating with Claude');
    try {
      const { spawn } = require('child_process');

      // Run claude auth login in interactive mode
      // This will open a browser for the user to authenticate
      logWithCategory('info', LogCategory.SYSTEM, 'Running: claude auth login');

      return new Promise((resolve) => {
        const authProcess = spawn('claude', ['auth', 'login'], {
          stdio: 'inherit', // Allow browser interaction
          shell: true
        });

        authProcess.on('close', (code: number) => {
          if (code === 0) {
            logWithCategory('info', LogCategory.SYSTEM, 'Authentication successful');
            resolve({ success: true, message: 'Authentication successful' });
          } else {
            logWithCategory('error', LogCategory.SYSTEM, `Authentication failed with code ${code}`);
            resolve({
              success: false,
              error: `Authentication process exited with code ${code}`
            });
          }
        });

        authProcess.on('error', (error: Error) => {
          logWithCategory('error', LogCategory.SYSTEM, `Authentication error: ${error.message}`);
          resolve({
            success: false,
            error: error.message
          });
        });
      });
    } catch (error: any) {
      logWithCategory('error', LogCategory.SYSTEM, `Failed to authenticate: ${error.message}`);
      return {
        success: false,
        error: error.message || 'Authentication failed'
      };
    }
  });

  logger.info('IPC handlers registered');
}

/**
 * Launch-time Docker readiness gate.
 *
 * Replaces the old single-shot `docker info` (CLI-only, no retry, no process
 * awareness) with:
 *   1. A direct dockerode daemon ping (authoritative - independent of the
 *      `docker` CLI being slow/missing on PATH).
 *   2. If unreachable, check whether Docker Desktop's process is already
 *      running - if so, this is the "still initializing" case: poll the ping
 *      for up to ~90s and do NOT relaunch it.
 *   3. If the process isn't running, start Docker Desktop (tray-only - the
 *      dashboard window is controlled by Docker Desktop's own startup
 *      setting) and poll the ping for up to ~120s.
 *   4. Once the daemon is reachable, ensure the core containers
 *      (postgres/pgbouncer) are up via mcpSystem.ensureCoreContainers()
 *      before returning, so the DB pool init that follows doesn't hit a cold
 *      database.
 *
 * Returns true when it's safe to proceed, false when the user chose to quit.
 * Never calls app.quit() itself - caller owns that decision.
 */
async function ensureDockerReadyForLaunch(): Promise<boolean> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    logWithCategory('info', LogCategory.DOCKER, 'Pinging Docker daemon (dockerode)...');
    const pingResult = await docker.pingDockerDaemon();
    let daemonReady = pingResult.reachable;

    if (!daemonReady) {
      const processRunning = await docker.isDockerDesktopProcessRunning();

      if (processRunning) {
        logWithCategory('info', LogCategory.DOCKER,
          'Docker Desktop process is running but daemon is not responding yet - ' +
          'treating as still-initializing and polling (no relaunch)...');

        const waitResult = await docker.waitForDockerPingReady(90, (progress) => {
          logWithCategory('debug', LogCategory.DOCKER,
            `Docker init wait: ${progress.message} (${progress.percent}%)`);
        });
        daemonReady = waitResult.success;
      } else {
        logWithCategory('info', LogCategory.DOCKER,
          'Docker Desktop process is not running - starting it...');

        const startResult = await docker.startDockerDesktop((progress) => {
          logWithCategory('debug', LogCategory.DOCKER,
            `Docker start: ${progress.message} (${progress.percent}%)`);
        });

        if (!startResult.success) {
          logWithCategory('warn', LogCategory.DOCKER,
            `startDockerDesktop reported failure (continuing to poll anyway): ${startResult.error}`);
        }

        const waitResult = await docker.waitForDockerPingReady(120, (progress) => {
          logWithCategory('debug', LogCategory.DOCKER,
            `Docker start wait: ${progress.message} (${progress.percent}%)`);
        });
        daemonReady = waitResult.success;
      }
    }

    if (!daemonReady) {
      // Secondary confirmation via the CLI before giving up entirely - the ping
      // is authoritative, but this catches the unlikely case of a socket/pipe
      // probe issue where the CLI path would still work.
      const cliStatus = await docker.checkDockerHealth();
      daemonReady = cliStatus.running && cliStatus.healthy;

      if (daemonReady) {
        logWithCategory('info', LogCategory.DOCKER,
          'Daemon ping failed but CLI confirms Docker is healthy - proceeding');
      }
    }

    if (daemonReady) {
      logWithCategory('info', LogCategory.DOCKER, 'Docker daemon is reachable - ensuring core containers...');

      const containerResult = await mcpSystem.ensureCoreContainers((progress) => {
        logWithCategory('debug', LogCategory.DOCKER,
          `Core container startup: ${progress.message} (${progress.percent}%)`);
      });

      if (containerResult.success) {
        return true;
      }

      if (containerResult.error === 'INVALID_CONFIG') {
        // First-run case: env config (MCP_AUTH_TOKEN/POSTGRES_PASSWORD) isn't
        // written yet. That's the setup wizard's job, not this gate's - let
        // launch proceed so isFirstRun()/createWizardWindow() can run.
        logWithCategory('info', LogCategory.DOCKER,
          'Core containers not started - environment not configured yet (first run). Deferring to setup wizard.');
        return true;
      }

      // Surface the result (including PORT_CONFLICT) - never swallow it.
      logWithCategory('error', LogCategory.DOCKER,
        `Failed to ensure core containers (${containerResult.error}): ${containerResult.message}`);

      const isPortConflict = containerResult.error === 'PORT_CONFLICT';
      const choice = await dialog.showMessageBox({
        type: 'error',
        title: isPortConflict ? 'Port Conflict' : 'Container Startup Failed',
        message: isPortConflict
          ? 'A required port is already in use'
          : 'Could not start required Docker containers',
        detail: `${containerResult.message}\n\nWould you like to retry, open Docker Desktop to investigate, or quit?`,
        buttons: ['Retry', 'Open Docker Desktop', 'Quit'],
        defaultId: 0,
        cancelId: 2,
      });

      if (choice.response === 0) continue; // Retry the whole gate
      if (choice.response === 1) {
        await docker.startDockerDesktop();
        continue; // Loop back and re-check after giving the user a look
      }
      return false; // Quit
    }

    // Daemon genuinely unreachable - offer Retry / Open Docker Desktop / Quit
    // instead of exiting immediately.
    const choice = await dialog.showMessageBox({
      type: 'warning',
      title: 'Docker Desktop Required',
      message: 'Docker daemon is not responding',
      detail:
        `FictionLab could not reach the Docker daemon.\n\n` +
        (pingResult.error ? `Last error: ${pingResult.error}\n\n` : '') +
        `Make sure Docker Desktop is installed and running, then click Retry. ` +
        `If it's still starting up, give it a few more seconds first.`,
      buttons: ['Retry', 'Open Docker Desktop', 'Quit'],
      defaultId: 0,
      cancelId: 2,
    });

    if (choice.response === 0) continue;
    if (choice.response === 1) {
      await docker.startDockerDesktop();
      continue;
    }
    return false;
  }
}

// --help / -help: print CLI usage and exit before the app initializes further. No window is
// opened. On Windows, a packaged (non-dev) build launched without an attached console will
// not surface this stdout output in the parent shell — this works reliably when run from a
// dev checkout / terminal (e.g. `npm start -- --help`, `electron . --help`).
if (process.argv.includes('--help') || process.argv.includes('-help')) {
  const usageLines = [
    `${app.getName()} v${app.getVersion()}`,
    '',
    'Usage: electron . [flags]',
    '',
    'Flags:',
    '  --dev           Run in development mode',
    '  --help, -help   Show this usage information and exit',
    '',
    'Once the app is running, the full IPC channel surface (including plugin-namespaced',
    "channels) can be listed via the 'help' IPC channel, e.g.:",
    "  ipcRenderer.invoke('help')            // all registered channels",
    "  ipcRenderer.invoke('help', 'docker')  // only channels starting with 'docker'",
  ];
  process.stdout.write(usageLines.join('\n') + '\n');
  app.quit();
  process.exit(0);
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  // Initialize logging system after app is ready
  initializeLogger();
  logger.info('App is ready');

  // Finder does not inherit the shell PATH. Apply our existing macOS tool
  // paths before plugins/MCP clients spawn node or service checks run docker.
  if (process.platform === 'darwin') {
    process.env.PATH = prerequisites.getFixedEnv().PATH;
  }

  // Set Windows App User Model ID for proper taskbar behavior
  if (process.platform === 'win32') {
    app.setAppUserModelId('net.fictionlab.studio');
  }

  // CRITICAL: Check Docker before initializing database and MCP client
  // Docker is a core dependency - MCP servers run in Docker containers
  try {
    logWithCategory('info', LogCategory.SYSTEM, 'Checking Docker status...');

    // First, check if Docker is installed at all
    const dockerInstalled = await prerequisites.checkDockerInstalled();

    if (!dockerInstalled.installed) {
      // Docker is NOT installed - show helpful dialog with download link
      logWithCategory('warn', LogCategory.DOCKER, 'Docker Desktop is not installed');

      const downloadUrl = installationWizard.getDockerDownloadUrl();
      const response = await dialog.showMessageBox({
        type: 'warning',
        title: 'Docker Desktop Required',
        message: 'Docker Desktop is not installed',
        detail: `This application requires Docker Desktop to run MCP servers.\n\n` +
          `Please download and install Docker Desktop, then restart this application.\n\n` +
          `Download URL:\n${downloadUrl}`,
        buttons: ['Download Docker Desktop', 'Exit'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response.response === 0) {
        // User clicked "Download Docker Desktop"
        await installationWizard.openDownloadPage();
        logWithCategory('info', LogCategory.DOCKER, 'Opened Docker Desktop download page');
      }

      app.quit();
      return;
    }

    // Docker is installed - run the daemon-ping-first readiness gate (with
    // process-awareness, retries, and container startup). Offers Retry/Open/Quit
    // on failure instead of exiting immediately.
    const dockerReady = await ensureDockerReadyForLaunch();
    if (!dockerReady) {
      logWithCategory('warn', LogCategory.DOCKER, 'User chose to quit from the Docker readiness gate');
      app.quit();
      return;
    }

    logWithCategory('info', LogCategory.DOCKER, 'Docker daemon and core containers are ready');
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    logWithCategory('error', LogCategory.DOCKER, `Unexpected error in Docker readiness gate: ${errorMessage}`);

    const choice = await dialog.showMessageBox({
      type: 'error',
      title: 'Docker Required',
      message: 'Unexpected error while checking Docker Desktop',
      detail:
        `Error: ${errorMessage}\n\n` +
        `Docker Desktop is required to run this application.\n\n` +
        `Would you like to retry, open Docker Desktop, or quit?`,
      buttons: ['Retry', 'Open Docker Desktop', 'Quit'],
      defaultId: 0,
      cancelId: 2,
    });

    if (choice.response === 2) {
      app.quit();
      return;
    }
    // Give the gate one more shot (Retry, or after opening Docker Desktop).
    // Bounded: if this second attempt itself throws, don't let the rejection
    // escape the promise chain and leave the app with no window and no
    // dialog - show a final error and quit instead.
    try {
      if (choice.response === 1) {
        await docker.startDockerDesktop();
      }

      const retryReady = await ensureDockerReadyForLaunch();
      if (!retryReady) {
        app.quit();
        return;
      }
    } catch (retryError: any) {
      const retryErrorMessage = retryError.message || String(retryError);
      logWithCategory('error', LogCategory.DOCKER, `Docker readiness retry failed: ${retryErrorMessage}`);
      await dialog.showMessageBox({
        type: 'error',
        title: 'Docker Required',
        message: 'Docker Desktop could not be verified',
        detail: `Error: ${retryErrorMessage}\n\nThe application will now close.`,
      });
      app.quit();
      return;
    }
  }

  setupIPC();
  createMenu();

  // Check if this is the first run BEFORE trying to connect to database
  // On first run, the MCP containers (including PostgreSQL) haven't been started yet
  const isFirst = await setupWizard.isFirstRun();
  logger.info(`First run: ${isFirst}`);

  if (isFirst) {
    // Show setup wizard - database will be initialized after MCP system starts
    createWizardWindow();
  } else {
    // Not first run - MCP containers should be running, initialize database
    try {
      logWithCategory('info', LogCategory.SYSTEM, 'Initializing database pool...');
      await initializeDatabasePool();
      logWithCategory('info', LogCategory.SYSTEM, 'Database pool initialized');
    } catch (error) {
      logWithCategory('error', LogCategory.SYSTEM, 'Error initializing database:', error);
      // Database connection failed - likely MCP containers not running
      // Show helpful error with option to start MCP system
      const response = await dialog.showMessageBox({
        type: 'error',
        title: 'Database Connection Failed',
        message: 'Could not connect to the database',
        detail: `The application could not connect to the PostgreSQL database.\n\n` +
          `This usually means the MCP containers are not running.\n\n` +
          `Error: ${error}\n\n` +
          `Would you like to start the MCP system now?`,
        buttons: ['Start MCP System', 'Exit'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response.response === 0) {
        // User wants to start MCP system
        try {
          logWithCategory('info', LogCategory.SYSTEM, 'Starting MCP system...');
          const startResult = await mcpSystem.startMCPSystem();

          if (startResult.success) {
            logWithCategory('info', LogCategory.SYSTEM, 'MCP system started, retrying database connection...');
            // Wait a moment for PostgreSQL to be ready
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Retry database initialization
            await initializeDatabasePool();
            logWithCategory('info', LogCategory.SYSTEM, 'Database pool initialized after MCP start');
          } else {
            throw new Error(startResult.error || 'Failed to start MCP system');
          }
        } catch (retryError) {
          logWithCategory('error', LogCategory.SYSTEM, 'Failed to recover:', retryError);
          dialog.showErrorBox('Initialization Error',
            `Failed to start MCP system and connect to database.\n\n` +
            `Error: ${retryError}\n\n` +
            `Please try restarting the application.`);
          app.quit();
          return;
        }
      } else {
        app.quit();
        return;
      }
    }

    // Initialize GitHub credentials from environment
    try {
      const config = await envConfig.loadEnvConfig();
      if (config.GITHUB_TOKEN) {
        const { getGitHubCredentialManager } = await import('./github-credential-manager');
        getGitHubCredentialManager(config.GITHUB_TOKEN);
        logger.info('GitHub credentials initialized from environment');
      }
    } catch (error) {
      logger.warn('Error initializing GitHub credentials from environment:', error);
    }
    // Check for pending migrations before showing main window
    try {
      logWithCategory('info', LogCategory.SYSTEM, 'Checking for pending migrations...');
      const pendingMigrations = await migrations.checkForPendingMigrations();

      if (pendingMigrations.hasPending) {
        logWithCategory('info', LogCategory.SYSTEM,
          `Found ${pendingMigrations.migrations.length} pending migrations ` +
          `(${pendingMigrations.criticalCount} critical, ${pendingMigrations.optionalCount} optional)`
        );

        // Log each pending migration
        pendingMigrations.migrations.forEach(migration => {
          logWithCategory('info', LogCategory.SYSTEM,
            `  - Migration ${migration.version}: ${migration.description} ` +
            `(${migration.steps.length} steps, critical: ${migration.critical || false})`
          );
        });

        // If there are critical migrations, they should be handled
        if (pendingMigrations.criticalCount > 0) {
          logWithCategory('warn', LogCategory.SYSTEM,
            'Critical migrations detected! Showing migration wizard.'
          );
        }

        // Show migration wizard instead of main window
        createMigrationWizardWindow();
        return; // Don't continue to create main window
      } else {
        logWithCategory('info', LogCategory.SYSTEM, 'No pending migrations found');
      }
    } catch (error) {
      logger.error('Error checking for pending migrations:', error);
      // Non-fatal, just log and continue
    }

    // Show main application window
    createWindow();

    // Initialize plugin system after main window is created
    // (Database and MCP client are already initialized before setupIPC)
    try {
      logWithCategory('info', LogCategory.SYSTEM, 'Initializing plugin system...');

      // Set main window reference BEFORE initializing plugins
      // so that plugin-state-changed events can be sent during activation
      if (mainWindow) {
        pluginManager.setMainWindow(mainWindow);
      }

      // Initialize plugin manager (discovers and activates plugins)
      await pluginManager.initialize();

      logWithCategory('info', LogCategory.SYSTEM, 'Plugin system initialized successfully');
    } catch (error) {
      logWithCategory('error', LogCategory.SYSTEM, 'Error initializing plugin system:', error);
      // Non-fatal, just log and continue
    }

    // Auto-check for updates on startup (only for non-first-run)
    try {
      const shouldCheck = await updater.shouldAutoCheck();
      if (shouldCheck) {
        logWithCategory('info', LogCategory.SYSTEM, 'Auto-checking for updates...');
        const updates = await updater.checkForAllUpdates();

        if (updates.hasUpdates) {
          logWithCategory('info', LogCategory.SYSTEM, 'Updates available!');
          // Notify renderer if window is ready
          if (mainWindow) {
            mainWindow.webContents.send('updater:auto-check-complete', updates);
          }
        } else {
          logWithCategory('info', LogCategory.SYSTEM, 'All components are up to date');
        }
      }
    } catch (error) {
      logger.error('Error during auto-update check:', error);
      // Non-fatal, just log and continue
    }
  }

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      // Check again if first run when re-activating
      setupWizard.isFirstRun().then(isFirst => {
        if (isFirst) {
          createWizardWindow();
        } else {
          createWindow();
        }
      });
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app before quit with proper async cleanup
let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting) {
    // Already cleaning up, allow quit to proceed
    return;
  }

  // Prevent default quit to allow async cleanup
  event.preventDefault();
  isQuitting = true;

  logger.info('App is quitting...');

  // Clean up plugin system
  try {
    logWithCategory('info', LogCategory.SYSTEM, 'Cleaning up plugin system...');
    await pluginManager.cleanup();
  } catch (error) {
    logWithCategory('error', LogCategory.SYSTEM, 'Error cleaning up plugin system:', error);
  }

  // Close database connection pool
  try {
    await closeDatabasePool();
  } catch (error) {
    logWithCategory('error', LogCategory.SYSTEM, 'Error closing database pool:', error);
  }

  // Now actually quit
  logWithCategory('info', LogCategory.SYSTEM, 'Cleanup complete, quitting app');
  app.quit();
});

// Log any unhandled errors and prevent default error dialog
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  console.error('UNCAUGHT EXCEPTION:', error);
  // Prevent the error dialog sound
  return true;
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  console.error('UNHANDLED REJECTION:', reason);
});
