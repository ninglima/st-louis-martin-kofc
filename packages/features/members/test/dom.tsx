import { JSDOM } from 'jsdom';
import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * A real DOM, a real React root, and a real click.
 *
 * The other component tests in this package render to a string with
 * `react-dom/server`, which is enough to pin what the markup SAYS but cannot
 * reach a single line of behaviour: a static render never attaches a handler,
 * so `onConfirm` -- the whole apply path, including which toast announces the
 * result -- was unreachable from any test. A review pasted the original
 * green-toast-on-a-failed-run defect back into the preview verbatim and all
 * 220 tests passed.
 *
 * So: jsdom, but deliberately NOT as vitest's `environment`. Switching the
 * environment flips vite into web resolution, and `@kit/ui` does not declare
 * `react` as a dependency of its own -- under pnpm's strict layout every
 * `import 'react'` inside the design system then fails to resolve. Installing
 * the globals by hand keeps the Node resolution that already works and costs
 * one devDependency instead of a second module graph.
 *
 * No testing library and no user-event: `element.click()` inside `act` is the
 * whole of what these tests need, and the point of this file is to add a
 * capability, not a framework.
 */
export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    // Without an origin jsdom refuses to hand out `localStorage`, which the
    // property copy below touches.
    url: 'http://localhost/',
  });

  const target = globalThis as Record<string, unknown>;

  // React 19 refuses to run `act` outside an environment that claims to be a
  // test one, and warns loudly about updates outside `act` if it is unset.
  target.IS_REACT_ACT_ENVIRONMENT = true;

  // Copied rather than assigned one by one: React reaches for a long tail of
  // browser globals (`Node`, `Event`, `MutationObserver`, `requestAnimation
  // Frame`, ...) and a missing one surfaces as an unrelated error deep inside
  // the renderer. Anything Node already defines is left alone -- `navigator`
  // in particular is getter-only on the Node 24 global.
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in target) continue;

    target[key] = (dom.window as unknown as Record<string, unknown>)[key];
  }

  // Node defines these three itself, so the loop above leaves them alone --
  // and Node's `FormData` cannot be constructed from an HTMLFormElement at
  // all, which is exactly what a submit handler does. They have to come from
  // the same realm as the document, and as each other: the upload form asks
  // `file instanceof File` about a value it pulled out of a `FormData`, and
  // two realms' `File` are two different classes.
  for (const key of ['FormData', 'File', 'Blob'] as const) {
    target[key] = (dom.window as unknown as Record<string, unknown>)[key];
  }

  target.window = dom.window;
  target.document = dom.window.document;
}

export interface Mounted {
  container: HTMLElement;
  /** The first element carrying this `data-test`, or null. */
  find: (dataTest: string) => HTMLElement | null;
  /** Clicks it, flushing every state update and promise the click sets off. */
  click: (dataTest: string) => Promise<void>;
  unmount: () => void;
}

export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement('div');

  document.body.append(container);

  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  const find = (dataTest: string) =>
    container.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);

  return {
    container,
    find,
    click: async (dataTest: string) => {
      const element = find(dataTest);

      if (element === null) {
        throw new Error(`No element with data-test="${dataTest}" to click.`);
      }

      // `act` with an async callback drains the microtask queue, so a handler
      // that awaits a server action is finished -- and its state committed --
      // by the time this resolves.
      await act(async () => {
        element.click();
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
