/**
 * Current Electron window zoom factor, kept in sync with the main process.
 *
 * Zoom scales CSS pixels but NOT the native traffic-light buttons, so any
 * traffic-light-safe left padding must be recomputed whenever this changes.
 */
import { useEffect, useState } from 'react';

import { isElectronMode } from '@renderer/api';

export function useZoomFactor(): number {
  const [zoomFactor, setZoomFactor] = useState(1);

  useEffect(() => {
    if (!isElectronMode()) return;
    void window.electronAPI!.getZoomFactor().then(setZoomFactor).catch(() => {});
    return window.electronAPI!.onZoomFactorChanged(setZoomFactor);
  }, []);

  return zoomFactor;
}
