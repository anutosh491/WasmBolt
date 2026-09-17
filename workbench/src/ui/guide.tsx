import { useEffect, useRef } from 'react';
import * as React from 'react';

import { sections } from '../generated/guide';

/** Own the modal lifecycle; opening the guide does not change session state. */
export function Guide({ onClose }: { onClose(): void }): React.ReactElement {
  const node = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = node.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={node}
      className="wasmbolt-guide"
      aria-labelledby="wasmbolt-guide-title"
      onClose={onClose}
      onKeyDown={event => event.stopPropagation()}
    >
      <header>
        <h2 id="wasmbolt-guide-title">WasmBolt guide</h2>
        <button onClick={() => node.current?.close()}>Close guide</button>
      </header>
      <nav aria-label="Guide sections">
        {sections.map(({ title }, index) => (
          <button
            key={title}
            onClick={() => {
              const heading = node.current?.querySelector<HTMLElement>(
                `#wasmbolt-guide-${index}`
              );
              heading?.scrollIntoView({ block: 'start' });
              heading?.focus({ preventScroll: true });
            }}
          >
            {title}
          </button>
        ))}
      </nav>
      <article>
        {sections.map(({ title, html }, index) => (
          <section key={title}>
            <h3 id={`wasmbolt-guide-${index}`} tabIndex={-1}>
              {title}
            </h3>
            {/* This HTML is generated only from the repository's README. */}
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </section>
        ))}
      </article>
    </dialog>
  );
}
