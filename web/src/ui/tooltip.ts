/**
 * Reusable contextual info tooltip ("i") component.
 * Supports:
 * - Instant hover preview
 * - Click-to-pin (persists open for formula inspection / touch screens)
 * - Click-outside & Escape key dismissal
 * - Mathematical formula display and statistical caveats
 * - Keyboard accessibility (tabindex + focus)
 */

export interface TooltipInfo {
  title: string;
  description: string;
  formula?: string;
  caveat?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
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
 * Renders an info icon ("i") with an embedded floating popover.
 */
export function renderInfoTooltip(info: TooltipInfo): string {
  const pos = info.position ?? 'top';

  const formulaHtml = info.formula
    ? `
      <div class="info-formula-block">
        <span class="info-section-tag">FORMULA</span>
        <code class="info-formula">${escapeHtml(info.formula)}</code>
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

  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const clickedTip = target?.closest('.info-tip') as HTMLElement | null;

    if (clickedTip) {
      // Toggle pinned state on the clicked tip
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
