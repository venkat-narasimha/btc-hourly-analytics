import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TourEngine, GLOBAL_TOUR_STEPS, PAGE_TOUR_STEPS, type TourStep } from './tour';
import type { TabId } from '../types';

describe('Tour System', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};

    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
      clear: () => { mockStorage = {}; },
      removeItem: (key: string) => { delete mockStorage[key]; },
    };
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it('defines 11 global tour steps across all analytical tabs', () => {
    expect(GLOBAL_TOUR_STEPS.length).toBe(11);
    for (const step of GLOBAL_TOUR_STEPS) {
      expect(step.id).toBeDefined();
      expect(step.title).toBeTruthy();
      expect(step.content).toBeTruthy();
      expect(step.targetSelector).toBeTruthy();
    }
  });

  it('provides contextual page walkthrough steps for all 9 tabs', () => {
    const tabs: TabId[] = [
      'overview',
      'price',
      'seasonality',
      'heatmap',
      'volatility',
      'flow',
      'calendar',
      'quality',
      'validation',
    ];

    for (const tab of tabs) {
      const steps = PAGE_TOUR_STEPS[tab];
      expect(steps).toBeDefined();
      expect(steps.length).toBeGreaterThanOrEqual(2);
      for (const step of steps) {
        expect(step.title).toBeTruthy();
        expect(step.content).toBeTruthy();
      }
    }
  });

  it('checks and updates localStorage completion status', () => {
    const callbacks = {
      onTabChange: vi.fn(),
      onOpenVerifyDrawer: vi.fn(),
    };
    const engine = new TourEngine(callbacks);

    expect(engine.shouldAutoStartGlobal()).toBe(true);

    engine.markGlobalTourCompleted();
    expect(engine.shouldAutoStartGlobal()).toBe(false);
  });

  it('manages tour state and active step index', () => {
    const onTabChange = vi.fn();
    const engine = new TourEngine({ onTabChange });

    const mockSteps: TourStep[] = [
      {
        id: 'mock-1',
        title: 'Step 1',
        content: 'Content 1',
        targetSelector: '#test-target-1',
        tab: 'overview',
      },
      {
        id: 'mock-2',
        title: 'Step 2',
        content: 'Content 2',
        targetSelector: '#test-target-2',
        tab: 'price',
      },
    ];

    expect(engine.isRunning()).toBe(false);
    engine.start(mockSteps, false);
    expect(engine.isRunning()).toBe(true);

    engine.next(false);
    expect(engine.isRunning()).toBe(true);

    engine.prev(false);
    expect(engine.isRunning()).toBe(true);

    engine.end(false);
    expect(engine.isRunning()).toBe(false);
  });
});
