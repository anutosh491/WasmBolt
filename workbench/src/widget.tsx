import type { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

/** Keep the React root until disposal so layout changes retain view state. */
export class ReactWidget extends Widget {
  constructor(private readonly render: () => ReactNode) {
    super();
    this.node.tabIndex = -1;
  }

  dispose(): void {
    if (!this.isDisposed) {
      this.root?.unmount();
      this.root = null;
      super.dispose();
    }
  }

  protected onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    this.update();
  }

  protected onUpdateRequest(): void {
    if (this.isAttached) {
      this.root ??= createRoot(this.node);
      this.root.render(this.render());
    }
  }

  protected onActivateRequest(): void {
    const editor = this.node.querySelector('.cm-content');
    if (editor instanceof HTMLElement) {
      editor.focus();
    } else {
      this.node.focus();
    }
  }

  private root: Root | null = null;
}
