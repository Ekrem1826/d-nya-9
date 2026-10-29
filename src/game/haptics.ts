/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadSettings } from './settings.ts';

function triggerVibration(pattern: number | number[]): void {
  try {
    const settings = loadSettings();
    if (!settings.vibrationEnabled) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Silently ignore if vibration is unsupported or blocked by WebView/browser
  }
}

export const haptics = {
  vibrateGoal(): void {
    triggerVibration([110, 50, 160]);
  },
  vibrateMatchEnd(): void {
    triggerVibration([140, 70, 140]);
  },
  vibrateTap(): void {
    triggerVibration(25);
  },
};
