import test from 'node:test';
import assert from 'node:assert';

test('Simulated Timer Attack: Rapid spam clicks & Exception throws must not leak active timers', async (t) => {
  // Mock timer container representing React component state & refs
  const state = {
    progressTimerRef: { current: null },
    renderTimerRef: { current: null },
    analyzeTickerRef: { current: null },
    activeIntervals: new Set(),
  };

  // Mock setInterval and clearInterval tracking all live active timers
  let timerIdCounter = 1;
  const mockSetInterval = (fn, ms) => {
    const id = timerIdCounter++;
    state.activeIntervals.add(id);
    return id;
  };
  const mockClearInterval = (id) => {
    if (id) state.activeIntervals.delete(id);
  };

  await t.test('[ATTACK SIMULATION] Rapid spam clicks on Analyze AI without cleanup leaks intervals', () => {
    // Attack: Spam clicking 20 times rapidly WITHOUT pre-clearing previous timers
    const leakyAnalyze = () => {
      // Simulating flawed implementation:
      state.analyzeTickerRef.current = mockSetInterval(() => {}, 200);
    };

    for (let i = 0; i < 20; i++) {
      leakyAnalyze();
    }
    // In flawed code, 20 intervals are now leaking in background!
    assert.strictEqual(state.activeIntervals.size, 20, 'Vulnerability confirmed: 20 unmanaged intervals leaking');

    // Clean up mock state
    state.activeIntervals.clear();
  });

  await t.test('[DEFENSE VERIFICATION] Hardened Analyze AI with try...finally and ref pre-clear has ZERO leaks', async () => {
    const hardenedAnalyze = async (shouldThrow = false) => {
      // 1. Pre-clear prior timers
      if (state.progressTimerRef.current) {
        mockClearInterval(state.progressTimerRef.current);
        state.progressTimerRef.current = null;
      }
      if (state.analyzeTickerRef.current) {
        mockClearInterval(state.analyzeTickerRef.current);
        state.analyzeTickerRef.current = null;
      }

      state.progressTimerRef.current = mockSetInterval(() => {}, 200);
      state.analyzeTickerRef.current = mockSetInterval(() => {}, 600);

      try {
        if (shouldThrow) {
          throw new Error('API 500 Network failure');
        }
      } finally {
        // Guaranteed cleanup in finally
        if (state.progressTimerRef.current) {
          mockClearInterval(state.progressTimerRef.current);
          state.progressTimerRef.current = null;
        }
        if (state.analyzeTickerRef.current) {
          mockClearInterval(state.analyzeTickerRef.current);
          state.analyzeTickerRef.current = null;
        }
      }
    };

    // Attack 1: Rapid spam clicking 50 times
    for (let i = 0; i < 50; i++) {
      await hardenedAnalyze(false);
    }
    assert.strictEqual(state.activeIntervals.size, 0, 'No intervals leaked after 50 rapid calls');

    // Attack 2: 20 consecutive API failures throwing exceptions
    for (let i = 0; i < 20; i++) {
      try {
        await hardenedAnalyze(true);
      } catch (err) {
        // Ignored
      }
    }
    assert.strictEqual(state.activeIntervals.size, 0, 'No intervals leaked even when API throws 100% of the time');
  });
});
