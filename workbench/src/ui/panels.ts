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
  sizes: [0.76, 0.24],
  children: [
    {
      type: 'split-area',
      orientation: 'horizontal',
      sizes: [0.14, 0.44, 0.42],
      children: [
        { type: 'tab-area', widgets: ['explorer'], currentIndex: 0 },
        { type: 'tab-area', widgets: ['source'], currentIndex: 0 },
        {
          type: 'tab-area',
          widgets: ['outputs', 'debugger'],
          currentIndex: 0
        }
      ]
    },
    { type: 'tab-area', widgets: ['terminal'], currentIndex: 0 }
  ]
};

/** Own pane composition; docking remains the responsibility of the host. */
export class PanePanel extends BoxPanel {
  constructor(
    private readonly panes: Readonly<Partial<Record<Pane, Widget>>>,
    area: Area | null,
    private readonly onChange: () => void,
    hidden: readonly Pane[] = []
  ) {
    super({ spacing: 0 });
    this.addClass('wasmbolt-panels');
    this.defaultArea = availableArea(defaultArea, panes) ?? defaultArea;
    const restored = availableArea(area ?? this.defaultArea, panes, hidden);
    this.section = this.create(restored ?? this.defaultArea);
    this.addWidget(this.section.widget);
  }

  /** Save the existing area format, including previously docked tab groups. */
  save(): Area {
    return this.section.save();
  }

  /** Reuse the views while replacing and disposing their layout containers. */
  reset(): void {
    this.replace(this.defaultArea);
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
    if (this.section.activate(pane) || !this.panes[pane]) {
      return;
    }
    this.replace(insertPane(this.save(), pane));
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
        const view = this.view(pane);
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
        panel.addWidget(this.view(pane));
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
          panel.currentWidget = this.view(pane);
          this.view(pane).activate();
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

  private view(pane: Pane): Widget {
    const view = this.panes[pane];
    if (!view) {
      throw new Error(`Pane ${pane} is not available.`);
    }
    return view;
  }

  private section: ISection;
  private readonly defaultArea: Area;
  private restoring = false;
}

function availableArea(
  area: Area,
  panes: Readonly<Partial<Record<Pane, Widget>>>,
  hidden: readonly Pane[] = []
): Area | null {
  if (area.type === 'tab-area') {
    const selected = area.widgets[area.currentIndex];
    const widgets = area.widgets.filter(
      pane => panes[pane] !== undefined && !hidden.includes(pane)
    );
    if (!widgets.length) {
      return null;
    }
    const selectedIndex = selected ? widgets.indexOf(selected) : -1;
    return {
      ...area,
      widgets,
      currentIndex:
        area.currentIndex === -1 ? -1 : selectedIndex >= 0 ? selectedIndex : 0
    };
  }
  const children = area.children.flatMap((child, index) => {
    const available = availableArea(child, panes, hidden);
    return available ? [{ area: available, size: area.sizes[index] }] : [];
  });
  if (!children.length) {
    return null;
  }
  if (children.length === 1) {
    return children[0].area;
  }
  return {
    ...area,
    children: children.map(child => child.area),
    sizes: children.map(child => child.size)
  };
}

function contains(area: Area, pane: Pane): boolean {
  return area.type === 'tab-area'
    ? area.widgets.includes(pane)
    : area.children.some(child => contains(child, pane));
}

function insertPane(area: Area, pane: Pane): Area {
  if (contains(area, pane)) {
    return area;
  }
  if (area.type === 'tab-area') {
    if (!area.widgets.includes('outputs')) {
      return area;
    }
    const order: readonly Pane[] = [
      'outputs',
      'run',
      'debugger',
      'diagnostics',
      'pipelines'
    ];
    const widgets = [...area.widgets, pane].sort(
      (left, right) => order.indexOf(left) - order.indexOf(right)
    );
    return {
      ...area,
      widgets,
      currentIndex: widgets.indexOf(pane)
    };
  }
  let inserted = false;
  return {
    ...area,
    children: area.children.map(child => {
      if (inserted || !contains(child, 'outputs')) {
        return child;
      }
      inserted = true;
      return insertPane(child, pane);
    })
  };
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
