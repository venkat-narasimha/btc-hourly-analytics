/**
 * Shimmer skeleton loaders for each page.
 * Uses CSS classes defined in style.css for shimmer animation.
 */

/** Overview/Dashboard skeleton: 5 KPI cards + 3 chart skeletons */
export function renderOverviewSkeleton(container: HTMLElement): void {
  container.innerHTML = `
    <div class="page-wrapper">
      <!-- KPI Grid: 5 cards -->
      <div class="kpi-grid">
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
      </div>

      <!-- Single wide chart card (timeline/stats) -->
      <div class="chart-card">
        <div class="skeleton skeleton-chart" style="height:200px;"></div>
      </div>

      <!-- Two chart cards side by side -->
      <div class="skeleton-row-2">
        <div class="chart-card">
          <div class="skeleton skeleton-chart" style="height:180px;"></div>
        </div>
        <div class="chart-card">
          <div class="skeleton skeleton-chart" style="height:180px;"></div>
        </div>
      </div>
    </div>
  `;
}

/** Chart page skeleton: header + filter bar + N chart cards */
export function renderChartPageSkeleton(container: HTMLElement, numCharts: number = 1): void {
  const chartCards = Array.from({ length: numCharts }, () => `
    <div class="chart-card">
      <div class="skeleton-text-block" style="margin-bottom:12px;">
        <div class="skeleton skeleton-text" style="width:40%;height:16px;margin-bottom:6px;"></div>
        <div class="skeleton skeleton-text" style="width:28%;height:12px;"></div>
      </div>
      <div class="skeleton skeleton-chart" style="min-height:300px;"></div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="page-wrapper">
      <!-- Page header skeleton -->
      <div class="skeleton-text-block" style="margin-bottom:16px;">
        <div class="skeleton skeleton-text" style="width:35%;height:22px;margin-bottom:8px;"></div>
        <div class="skeleton skeleton-text" style="width:55%;height:14px;"></div>
      </div>

      <!-- Filter bar skeleton -->
      <div class="skeleton skeleton-filter" style="height:36px;width:60%;margin-bottom:20px;"></div>

      <!-- Chart cards -->
      ${chartCards}
    </div>
  `;
}

/** Quality page skeleton: 4 KPI cards + 3 chart card blocks */
export function renderQualitySkeleton(container: HTMLElement): void {
  container.innerHTML = `
    <div class="page-wrapper">
      <!-- KPI Grid: 4 cards -->
      <div class="kpi-grid">
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
        <div class="skeleton skeleton-kpi" style="height:120px;"></div>
      </div>

      <!-- 3 chart card blocks with text skeletons -->
      <div class="chart-card">
        <div class="skeleton skeleton-text" style="width:30%;height:16px;margin-bottom:12px;"></div>
        <div class="skeleton skeleton-text" style="width:80%;height:12px;margin-bottom:8px;"></div>
        <div class="skeleton skeleton-text" style="width:70%;height:12px;margin-bottom:8px;"></div>
        <div class="skeleton skeleton-text" style="width:60%;height:12px;"></div>
      </div>
      <div class="chart-card">
        <div class="skeleton skeleton-text" style="width:35%;height:16px;margin-bottom:12px;"></div>
        <div class="skeleton skeleton-chart" style="height:180px;"></div>
      </div>
      <div class="chart-card">
        <div class="skeleton skeleton-text" style="width:28%;height:16px;margin-bottom:12px;"></div>
        <div class="skeleton skeleton-text" style="width:90%;height:12px;margin-bottom:8px;"></div>
        <div class="skeleton skeleton-text" style="width:75%;height:12px;"></div>
      </div>
    </div>
  `;
}
