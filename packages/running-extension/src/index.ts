// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { toArray } from '@lumino/algorithm';

import { Widget } from '@lumino/widgets';

import { ISignal, Signal } from '@lumino/signaling';

import {
  ILayoutRestorer,
  ILabShell,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { MainAreaWidget } from '@jupyterlab/apputils';

import { PathExt } from '@jupyterlab/coreutils';

import {
  IRunningSessions,
  IRunningSessionManagers,
  RunningSessionManagers,
  RunningSessions
} from '@jupyterlab/running';

import { Session } from '@jupyterlab/services';

import { ITranslator } from '@jupyterlab/translation';

import {
  consoleIcon,
  fileIcon,
  notebookIcon,
  runningIcon
} from '@jupyterlab/ui-components';

import { DocumentWidget } from '@jupyterlab/docregistry';

/**
 * The default running sessions extension.
 */
const plugin: JupyterFrontEndPlugin<IRunningSessionManagers> = {
  activate,
  id: '@jupyterlab/running-extension:plugin',
  provides: IRunningSessionManagers,
  requires: [ITranslator],
  optional: [ILayoutRestorer, ILabShell],
  autoStart: true
};

/**
 * Export the plugin as default.
 */
export default plugin;

/**
 * Activate the running plugin.
 */
function activate(
  app: JupyterFrontEnd,
  translator: ITranslator,
  restorer: ILayoutRestorer | null,
  labShell: ILabShell | null
): IRunningSessionManagers {
  const trans = translator.load('jupyterlab');
  const runningSessionManagers = new RunningSessionManagers();
  const running = new RunningSessions(runningSessionManagers, translator);
  running.id = 'jp-running-sessions';
  running.title.caption = trans.__('Running Terminals and Kernels');
  running.title.icon = runningIcon;

  // Let the application restorer track the running panel for restoration of
  // application state (e.g. setting the running panel as the current side bar
  // widget).
  if (restorer) {
    restorer.add(running, 'running-sessions');
  }
  if (labShell) {
    addOpenTabs(runningSessionManagers, labShell);
  }
  addKernelRunningSessionManager(runningSessionManagers, translator, app);
  // Rank has been chosen somewhat arbitrarily to give priority to the running
  // sessions widget in the sidebar.
  app.shell.add(running, 'left', { rank: 200 });

  return runningSessionManagers;
}

class OpenTabsSignaler {
  constructor(labShell: ILabShell) {
    this._labShell = labShell;
    this._labShell.layoutModified.connect(this._emitTabsChanged, this);
  }

  get tabsChanged(): ISignal<this, void> {
    return this._tabsChanged;
  }

  addWidget(widget: Widget): void {
    if (widget instanceof MainAreaWidget) {
      widget.content.title.changed.connect(this._emitTabsChanged, this);
      this._widgets.push(widget);
    }
  }

  private _emitTabsChanged(): void {
    this._widgets.forEach(widget => {
      widget.content.title.changed.disconnect(this._emitTabsChanged, this);
    });
    this._widgets = [];
    this._tabsChanged.emit(void 0);
  }

  private _tabsChanged = new Signal<this, void>(this);
  private _labShell: ILabShell;
  private _widgets: MainAreaWidget[] = [];
}

function addOpenTabs(managers: IRunningSessionManagers, labShell: ILabShell) {
  const signaler = new OpenTabsSignaler(labShell);

  managers.add({
    name: 'Open Tabs',
    running: () => {
      return toArray(labShell.widgets('main')).map((widget: Widget) => {
        signaler.addWidget(widget);
        return new OpenTab(widget);
      });
    },
    shutdownAll: () => {
      toArray(labShell.widgets('main')).forEach((widget: Widget) => {
        widget.close();
      });
    },
    refreshRunning: () => {
      return void 0;
    },
    runningChanged: signaler.tabsChanged
  });

  class OpenTab implements IRunningSessions.IRunningItem {
    constructor(widget: Widget) {
      this._widget = widget;
    }
    open() {
      labShell.activateById(this._widget.id);
    }
    shutdown() {
      this._widget.close();
    }
    icon() {
      // const icon = this._widget.icon;
      // let labIcon: LabIcon;
      // if (icon instanceof string) {
      //   labIcon = new LabIcon();
      // }
      return fileIcon;
    }
    label() {
      return this._widget.title.label;
    }
    labelTitle() {
      let labelTitle: string;
      if (this._widget instanceof DocumentWidget) {
        labelTitle = this._widget.context.path;
      } else {
        labelTitle = this._widget.title.label;
      }
      return labelTitle;
    }

    private _widget: Widget;
  }
}

/**
 * Add the running kernel manager (notebooks & consoles) to the running panel.
 */
function addKernelRunningSessionManager(
  managers: IRunningSessionManagers,
  translator: ITranslator,
  app: JupyterFrontEnd
) {
  const trans = translator.load('jupyterlab');
  const manager = app.serviceManager.sessions;
  const specsManager = app.serviceManager.kernelspecs;
  function filterSessions(m: Session.IModel) {
    return !!(
      (m.name || PathExt.basename(m.path)).indexOf('.') !== -1 || m.name
    );
  }

  managers.add({
    name: trans.__('Kernels'),
    running: () => {
      return toArray(manager.running())
        .filter(filterSessions)
        .map(model => new RunningKernel(model));
    },
    shutdownAll: () => manager.shutdownAll(),
    refreshRunning: () => manager.refreshRunning(),
    runningChanged: manager.runningChanged
  });

  class RunningKernel implements IRunningSessions.IRunningItem {
    constructor(model: Session.IModel) {
      this._model = model;
    }
    open() {
      const { path, type } = this._model;
      if (type.toLowerCase() === 'console') {
        void app.commands.execute('console:open', { path });
      } else {
        void app.commands.execute('docmanager:open', { path });
      }
    }
    shutdown() {
      return manager.shutdown(this._model.id);
    }
    icon() {
      const { name, path, type } = this._model;
      if ((name || PathExt.basename(path)).indexOf('.ipynb') !== -1) {
        return notebookIcon;
      } else if (type.toLowerCase() === 'console') {
        return consoleIcon;
      }
      return fileIcon;
    }
    label() {
      return this._model.name || PathExt.basename(this._model.path);
    }
    labelTitle() {
      const { kernel, path } = this._model;
      let kernelName = kernel?.name;
      if (kernelName && specsManager.specs) {
        const spec = specsManager.specs.kernelspecs[kernelName];
        kernelName = spec ? spec.display_name : 'unknown';
      }
      return trans.__('Path: %1\nKernel: %2', path, kernelName);
    }

    private _model: Session.IModel;
  }
}
