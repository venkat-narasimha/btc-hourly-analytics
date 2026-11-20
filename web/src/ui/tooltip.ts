/**
 * Reusable contextual info tooltip ("i") component.
 * Supports:
 * - Instant hover preview
 * - Click-to-pin (persists open for formula inspection / touch screens)
 * - Click-outside & Escape key dismissal
 * - Mathematical formula display and statistical caveats
 * - Keyboard accessibility (tabindex + focus)
 */

import { getMetricDef } from '../verify/registry';

export interface TooltipInfo {
  title: string;
  description: string;
  formula?: string;
  caveat?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  defId?: string;
  bucket?: string;
  metric?: string;
  target?: string;
  window?: number;
}

/**
 * Escapes HTML characters to prevent XSS.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders an inspect trigger icon button.
 */
export function renderInspectTrigger(
  defId: string,
  options?: {
    bucket?: string;
    metric?: string;
    target?: string;
    window?: number;
    title?: string;
  }
): string {
  const title = options?.title ?? 'Inspect & Verify';
  const bucketAttr = options?.bucket ? ` data-inspect-bucket="${escapeHtml(options.bucket)}"` : '';
  const metricAttr = options?.metric ? ` data-inspect-metric="${escapeHtml(options.metric)}"` : '';
  const targetAttr = options?.target ? ` data-inspect-target="${escapeHtml(options.target)}"` : '';
  const windowAttr = options?.window ? ` data-inspect-window="${options.window}"` : '';

  return `
    <button type="button" class="inspect-trigger-btn" data-inspect-def="${escapeHtml(defId)}"${bucketAttr}${metricAttr}${targetAttr}${windowAttr} aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="7" cy="7" r="4.5" />
        <line x1="10.5" y1="10.5" x2="14" y2="14" />
      </svg>
    </button>
  `;
}

/**
 * Renders an info icon ("i") with an embedded floating popover.
 * If defId is provided, formula is derived from registry and an "Inspect & Verify" button is added.
 */
export function renderInfoTooltip(info: TooltipInfo): string {
  const pos = info.position ?? 'top';

  let formula = info.formula;
  if (!formula && info.defId) {
    const def = getMetricDef(info.defId);
    if (def) {
      formula = def.formula;
    }
  }

  const formulaHtml = formula
    ? `
      <div class="info-formula-block">
        <span class="info-section-tag">FORMULA</span>
        <code class="info-formula">${escapeHtml(formula)}</code>
      </div>
    `
    : '';

  const caveatHtml = info.caveat
    ? `
      <div class="info-caveat-block">
        <span class="info-section-tag caveat">CAVEAT</span>
        <span class="info-caveat-text">${escapeHtml(info.caveat)}</span>
      </div>
    `
    : '';

  const inspectBtnHtml = info.defId
    ? `
      <button type="button" class="inspect-verify-btn" data-inspect-def="${escapeHtml(info.defId)}"${info.bucket ? ` data-inspect-bucket="${escapeHtml(info.bucket)}"` : ''}${info.metric ? ` data-inspect-metric="${escapeHtml(info.metric)}"` : ''}${info.target ? ` data-inspect-target="${escapeHtml(info.target)}"` : ''}${info.window ? ` data-inspect-window="${info.window}"` : ''}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        Inspect &amp; Verify
      </button>
    `
    : '';

  return `
    <span class="info-tip pos-${pos}" tabindex="0" role="button" aria-label="Information: ${escapeHtml(info.title)}">
      <span class="info-icon">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8" cy="8" r="6.5" />
          <line x1="8" y1="7.5" x2="8" y2="11.5" />
          <circle cx="8" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span class="info-popover" role="tooltip">
        <span class="info-title">${escapeHtml(info.title)}</span>
        <span class="info-description">${escapeHtml(info.description)}</span>
        ${formulaHtml}
        ${caveatHtml}
        ${inspectBtnHtml}
      </span>
    </span>
  `;
}

let isGlobalListenerAttached = false;

/**
 * Attaches document-level listeners for click-to-pin and click-outside dismissal.
 * Safe to call multiple times.
 */
export function setupTooltipInteractions(): void {
  if (isGlobalListenerAttached || typeof document === 'undefined') return;
  isGlobalListenerAttached = true;

  // When hovering or focusing any tooltip, dismiss all other pinned tooltips
  // to ensure only a single tooltip is ever visible at one time
  document.addEventListener(
    'mouseenter',
    (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const hoveredTip = target?.closest?.('.info-tip') as HTMLElement | null;
      if (hoveredTip) {
        document.querySelectorAll('.info-tip.pinned').forEach(el => {
          if (el !== hoveredTip) {
            el.classList.remove('pinned');
          }
        });
      }
    },
    true
  );

  document.addEventListener(
    'focusin',
    (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const focusedTip = target?.closest?.('.info-tip') as HTMLElement | null;
      if (focusedTip) {
        document.querySelectorAll('.info-tip.pinned').forEach(el => {
          if (el !== focusedTip) {
            el.classList.remove('pinned');
          }
        });
      }
    },
    true
  );

  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const verifyBtn = target?.closest('.inspect-verify-btn') as HTMLElement | null;
    if (verifyBtn) {
      // Unpin immediately so tooltip popover closes without stacked overlays
      document.querySelectorAll('.info-tip.pinned').forEach(el => el.classList.remove('pinned'));
      return;
    }

    const clickedTip = target?.closest('.info-tip') as HTMLElement | null;

    if (clickedTip) {
      // Toggle pinned state on the clicked tip, unpinning all others
      const isPinned = clickedTip.classList.contains('pinned');
      document.querySelectorAll('.info-tip.pinned').forEach(el => el.classList.remove('pinned'));
      if (!isPinned) {
        clickedTip.classList.add('pinned');
      }
      event.stopPropagation();
    } else {
      // Clicked outside — close any pinned popovers
      document.querySelectorAll('.info-tip.pinned').forEach(el => el.classList.remove('pinned'));
    }
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.info-tip.pinned').forEach(el => el.classList.remove('pinned'));
    }
  });
}
