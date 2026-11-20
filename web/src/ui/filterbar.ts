/**
 * Filterbar component: preset chips, date range inputs, timezone toggle.
 */

export interface FilterbarCallbacks {
  onRangeChange(startMs: number, endMs: number): void;
  onTimezoneChange(isIst: boolean): void;
  onPresetChange?(preset: Preset | 'Custom'): void;
}

export interface FilterbarOptions {
  minMs: number;
  maxMs: number;
  initialPreset?: Preset | 'Custom';
  initialStartMs?: number;
  initialEndMs?: number;
  initialIsIst?: boolean;
  showTimezone?: boolean; // default true
}

export type Preset = '1M' | '3M' | '1Y' | 'All';

function msToDateStr(ms: number): string {
  return new Date(ms).toISOString().substring(0, 10);
}

function presetToRange(preset: Preset, minMs: number, maxMs: number): { startMs: number; endMs: number } {
  let startMs = minMs;
  const endMs = maxMs;
  if (preset === '1M') {
    startMs = maxMs - 30 * 24 * 3600 * 1000;
  } else if (preset === '3M') {
    startMs = maxMs - 90 * 24 * 3600 * 1000;
  } else if (preset === '1Y') {
    startMs = maxMs - 365 * 24 * 3600 * 1000;
  }
  startMs = Math.max(startMs, minMs);
  return { startMs, endMs };
}

export function createFilterbar(
  container: HTMLElement,
  options: FilterbarOptions,
  callbacks: FilterbarCallbacks
): {
  getStartMs(): number;
  getEndMs(): number;
} {
  const { minMs, maxMs } = options;
  const showTimezone = options.showTimezone !== false;
  const initialIsIst = options.initialIsIst ?? false;
  const initialPreset = options.initialPreset ?? 'All';

  const currentInitStartMs = options.initialStartMs ?? minMs;
  const currentInitEndMs = options.initialEndMs ?? maxMs;

  const minDateStr = msToDateStr(minMs);
  const maxDateStr = msToDateStr(maxMs);
  const startValStr = msToDateStr(currentInitStartMs);
  const endValStr = msToDateStr(currentInitEndMs);

  const tzHtml = showTimezone ? `
    <div class="filterbar-sep"></div>
    <div class="tz-group">
      <button class="tz-btn${!initialIsIst ? ' active' : ''}" data-tz="utc">UTC</button>
      <button class="tz-btn${initialIsIst ? ' active' : ''}" data-tz="ist">IST</button>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="filterbar">
      <div class="preset-chips">
        <button class="preset-chip${initialPreset === '1M' ? ' active' : ''}" data-preset="1M">1M</button>
        <button class="preset-chip${initialPreset === '3M' ? ' active' : ''}" data-preset="3M">3M</button>
        <button class="preset-chip${initialPreset === '1Y' ? ' active' : ''}" data-preset="1Y">1Y</button>
        <button class="preset-chip${initialPreset === 'All' ? ' active' : ''}" data-preset="All">All</button>
      </div>
      <div class="filterbar-sep"></div>
      <div class="date-range-group">
        <span class="date-range-label">From</span>
        <input type="date" class="date-input" id="filterbar-start-date" value="${startValStr}" min="${minDateStr}" max="${maxDateStr}" />
        <span class="date-range-arrow">→</span>
        <input type="date" class="date-input" id="filterbar-end-date" value="${endValStr}" min="${minDateStr}" max="${maxDateStr}" />
      </div>
      ${tzHtml}
    </div>
  `;

  // State
  let currentStartMs = currentInitStartMs;
  let currentEndMs = currentInitEndMs;

  const presetChips = container.querySelectorAll<HTMLButtonElement>('.preset-chip');
  const startDateInput = container.querySelector<HTMLInputElement>('#filterbar-start-date')!;
  const endDateInput = container.querySelector<HTMLInputElement>('#filterbar-end-date')!;

  function applyPreset(preset: Preset) {
    presetChips.forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    const { startMs, endMs } = presetToRange(preset, minMs, maxMs);
    currentStartMs = startMs;
    currentEndMs = endMs;
    startDateInput.value = msToDateStr(startMs);
    endDateInput.value = msToDateStr(endMs);
    callbacks.onPresetChange?.(preset);
    callbacks.onRangeChange(startMs, endMs);
  }

  presetChips.forEach(btn => {
    btn.addEventListener('click', () => {
      applyPreset(btn.dataset.preset as Preset);
    });
  });

  function applyCustomDates() {
    presetChips.forEach(b => b.classList.remove('active'));
    const s = new Date(startDateInput.value + 'T00:00:00Z').getTime();
    const e = new Date(endDateInput.value + 'T23:59:59Z').getTime();
    if (!isNaN(s) && !isNaN(e) && s <= e) {
      currentStartMs = s;
      currentEndMs = e;
      callbacks.onPresetChange?.('Custom');
      callbacks.onRangeChange(s, e);
    }
  }

  startDateInput.addEventListener('change', applyCustomDates);
  endDateInput.addEventListener('change', applyCustomDates);

  // Timezone toggle
  if (showTimezone) {
    const tzButtons = container.querySelectorAll<HTMLButtonElement>('.tz-btn');
    tzButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const isIst = btn.dataset.tz === 'ist';
        tzButtons.forEach(b => b.classList.toggle('active', (b.dataset.tz === 'ist') === isIst));
        callbacks.onTimezoneChange(isIst);
      });
    });
  }

  return {
    getStartMs: () => currentStartMs,
    getEndMs: () => currentEndMs,
  };
}
