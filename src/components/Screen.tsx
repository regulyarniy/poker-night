/**
 * Общая рамка экрана (docs/SPEC.md §5.2).
 *
 * Шапка с «←» и правым действием, контейнер 430 px, safe-area.
 */

import type { ComponentChildren } from 'preact';
import { navigate } from '../router';

export type TopBarProps = {
  title?: string;
  back?: string | false;
  action?: { label: string; to?: string; onClick?: () => void; accent?: boolean };
};

export function TopBar({ title, back, action }: TopBarProps) {
  const backTo = back === undefined ? '/' : back;
  return (
    <header class="topbar">
      {backTo !== false ? (
        <button
          type="button"
          class="topbar__back"
          aria-label="Назад"
          onClick={() => navigate(backTo)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      ) : null}
      {title ? <h1 class="topbar__title">{title}</h1> : <span class="spacer" />}
      {action ? (
        <button
          type="button"
          class={`topbar__link${action.accent ? ' topbar__link--accent' : ''}`}
          onClick={() => {
            if (action.onClick) action.onClick();
            else if (action.to) navigate(action.to);
          }}
        >
          {action.label}
        </button>
      ) : null}
    </header>
  );
}

export function Screen({ children, flush }: { children: ComponentChildren; flush?: boolean }) {
  return <div class={flush ? 'screen screen--flush' : 'screen'}>{children}</div>;
}
