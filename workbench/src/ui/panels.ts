import {
  BoxPanel,
  SplitLayout,
  SplitPanel,
  TabPanel,
  Widget
} from '@lumino/widgets';

import type { Area, Pane } from '../model';
import { hasComparison, isToolArea } from '../model';

interface ISection {
  widget: Widget;
  save(): Area;
  activate(pane: Pane): boolean;
}

const defaultArea: Area = {
  type: 'split-area',
  orientation: 'vertical',
  sizes: [0.72, 0.28],
  children: [
    {
      type: 'split-area',
      orientation: 'horizontal',
      sizes: [0.16, 0.42, 0.42],
      children: [
        { type: 'tab-area', widgets: ['explorer'], currentIndex: 0 },
        { type: 'tab-area', widgets: ['source'], currentIndex: 0 },
        { type: 'tab-area', widgets: ['outputs'], currentIndex: 0 }
      ]
    },
    {
      type: 'tab-area',
      widgets: ['terminal', 'diagnostics', 'debugger', 'run', 'pipelines'],
      currentIndex: 0
    }
  ]
};

/** Own pane composition; docking remains the responsibility of the host. */
export class PanePanel extends BoxPanel {
  constructor(
    private readonly panes: Readonly<Record<Pane, Widget>>,
    area: Area | null,
    private readonly onChange: () => void
  ) {
    super({ spacing: 0 });
    this.addClass('wasmbolt-panels');
    this.section = this.create(area ?? defaultArea);
    this.addWidget(this.section.widget);
  }

  /** Save the existing area format, including previously docked tab groups. */
  save(): Area {
    return this.section.save();
  }

  /** Reuse the views while replacing and disposing their layout containers. */
  reset(): void {
    this.replace(defaultArea);
  }

  /** Toggle a second output group without disturbing the source split. */
  compare(): void {
    const area = this.save();
    this.replace(hasComparison(area) ? removeComparison(area) : compare(area));
  }

  dispose(): void {
    if (!this.isDisposed) {
      super.dispose();
      // The comparison view may currently be detached from the layout.
      for (const pane of Object.values(this.panes)) {
        pane.dispose();
      }
    }
  }

  private replace(area: Area): void {
    this.restoring = true;
    for (const pane of Object.values(this.panes)) {
      pane.parent = null;
    }
    if (!Object.values(this.panes).includes(this.section.widget)) {
      this.section.widget.dispose();
    }
    this.section = this.create(area);
    this.addWidget(this.section.widget);
    this.restoring = false;
    this.changed();
  }

  /** Reveal a pane before sending focus to its view. */
  activatePane(pane: Pane): void {
    this.section.activate(pane);
  }

  private create(area: Area, changed = () => this.changed()): ISection {
    if (area.type === 'tab-area') {
      const pane = area.widgets[0];
      // Preserve the saved area without a redundant tab around a fixed pane
      // or an output group that already owns its tabs.
      if (
        area.widgets.length === 1 &&
        (pane === 'explorer' ||
          pane === 'source' ||
          pane === 'outputs' ||
          pane === 'comparison')
      ) {
        const view = this.panes[pane];
        let widget: Widget = view;
        if (pane === 'source') {
          const panel = new BoxPanel({
            direction: 'top-to-bottom',
            spacing: 0
          });
          panel.addClass('wasmbolt-source');
          const heading = new Widget({ node: document.createElement('h2') });
          heading.addClass('wasmbolt-pane-heading');
          heading.node.textContent = view.title.label;
          panel.addWidget(heading);
          panel.addWidget(view);
          BoxPanel.setStretch(view, 1);
          widget = panel;
        } else {
          view.node.setAttribute('role', 'region');
        }
        view.show();
        return {
          widget,
          save: () => area,
          activate: target => {
            if (target !== pane) {
              return false;
            }
            view.activate();
            return true;
          }
        };
      }
      const tools = isToolArea(area.widgets);
      const panel = new TabPanel({ tabsMovable: false });
      panel.tabBar.allowDeselect = tools;
      if (tools) {
        panel.addClass('wasmbolt-tools');
        panel.tabBar.node.title = 'Select a tool to open or close it';
        const keydown = (event: KeyboardEvent) => {
          const tab = panel.tabBar.contentNode.children[panel.currentIndex];
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            tab?.contains(document.activeElement)
          ) {
            event.preventDefault();
            event.stopPropagation();
            panel.currentIndex = -1;
          }
        };
        panel.tabBar.node.addEventListener('keydown', keydown, true);
        panel.disposed.connect(() =>
          panel.tabBar.node.removeEventListener('keydown', keydown, true)
        );
      }
      const resize = () => {
        const collapsed = tools && panel.currentIndex === -1;
        panel.toggleClass('wasmbolt-collapsed', collapsed);
        panel.stackedPanel.setHidden(collapsed);
        panel.fit();
      };
      for (const pane of area.widgets) {
        panel.addWidget(this.panes[pane]);
      }
      panel.currentIndex = area.currentIndex;
      resize();
      panel.currentChanged.connect(() => {
        resize();
        changed();
      });
      return {
        widget: panel,
        save: () => ({ ...area, currentIndex: panel.currentIndex }),
        activate: pane => {
          if (!area.widgets.includes(pane)) {
            return false;
          }
          panel.currentWidget = this.panes[pane];
          this.panes[pane].activate();
          return true;
        }
      };
    }
    const panel = new SplitPanel({
      layout: new PaneLayout({
        orientation: area.orientation,
        renderer: SplitPanel.defaultRenderer
      })
    });
    // Keep expanded proportions while a tool group is folded away.
    let sizes = [...area.sizes];
    const resized = () => {
      panel.setRelativeSizes(sizes);
      changed();
    };
    const children = area.children.map(child => this.create(child, resized));
    for (const child of children) {
      panel.addWidget(child.widget);
    }
    panel.setRelativeSizes([...area.sizes]);
    panel.handleMoved.connect(() => {
      sizes = panel.relativeSizes();
      changed();
    });
    return {
      widget: panel,
      save: () => ({
        type: 'split-area',
        orientation: panel.orientation,
        sizes,
        children: children.map(child => child.save())
      }),
      activate: pane => children.some(child => child.activate(pane))
    };
  }

  private changed(): void {
    if (!this.isDisposed && !this.restoring) {
      this.onChange();
    }
  }

  private section: ISection;
  private restoring = false;
}

function compare(area: Area): Area {
  if (area.type === 'split-area') {
    return { ...area, children: area.children.map(compare) };
  }
  return area.widgets.includes('outputs')
    ? {
        type: 'split-area',
        orientation: 'horizontal',
        sizes: [0.5, 0.5],
        children: [
          area,
          {
            type: 'tab-area',
            widgets: ['comparison'],
            currentIndex: 0
          }
        ]
      }
    : area;
}

function removeComparison(area: Area): Area {
  if (area.type === 'tab-area') {
    const widgets = area.widgets.filter(pane => pane !== 'comparison');
    return {
      ...area,
      widgets,
      currentIndex: Math.min(area.currentIndex, widgets.length - 1)
    };
  }
  const entries = area.children
    .map((child, index) => ({
      child: removeComparison(child),
      size: area.sizes[index]
    }))
    .filter(
      ({ child }) => child.type !== 'tab-area' || child.widgets.length > 0
    );
  return entries.length === 1
    ? entries[0].child
    : {
        ...area,
        children: entries.map(entry => entry.child),
        sizes: entries.map(entry => entry.size)
      };
}

/** Retain proportions when the host changes size during restoration. */
class PaneLayout extends SplitLayout {
  protected onResize(message: Widget.ResizeMessage): void {
    this.setRelativeSizes(this.relativeSizes(), false);
    super.onResize(message);
  }
}
