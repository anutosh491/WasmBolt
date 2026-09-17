import { ILabShell } from '@jupyterlab/application';
import type { JupyterFrontEndPlugin } from '@jupyterlab/application';
import { PageConfig } from '@jupyterlab/coreutils';
import { Widget } from '@lumino/widgets';

let logo: Widget | null = null;

// Bundled only by lite/brand; installed JupyterLab keeps its own branding.
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'fortitudo:lite-brand',
  description: 'Link the JupyterLite logo to the WasmBolt home page.',
  autoStart: true,
  optional: [ILabShell],
  activate: (_, shell: ILabShell | null) => {
    if (!shell) {
      return;
    }
    const link = document.createElement('a');
    link.href = '/';
    link.title = 'WasmBolt home';
    link.setAttribute('aria-label', 'WasmBolt home');
    link.style.display = 'flex';
    link.style.alignItems = 'center';
    link.style.padding = '0 8px';

    const icon = document.createElement('img');
    const base = new URL(PageConfig.getBaseUrl(), document.baseURI);
    icon.src = new URL('icon.svg', base).href;
    icon.alt = '';
    icon.width = 24;
    icon.height = 24;
    link.append(icon);

    logo = new Widget({ node: link });
    logo.id = 'jp-MainLogo';
    shell.add(logo, 'top', { rank: 0 });
  },
  deactivate: () => {
    logo?.dispose();
    logo = null;
  }
};

export default plugin;
