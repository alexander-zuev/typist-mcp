import { vi } from 'vitest'

export function createClock(onCleanup: (cleanup: () => void) => void) {
  onCleanup(() => { vi.clearAllTimers(); vi.useRealTimers() })
  return {
    useFakeTimers: () => vi.useFakeTimers(),
    useRealTimers: () => vi.useRealTimers(),
    setSystemTime: (time: string | number | Date) => vi.setSystemTime(new Date(time)),
    advanceTimersByTime: (milliseconds: number) => vi.advanceTimersByTime(milliseconds),
    advanceTimersByTimeAsync: (milliseconds: number) => vi.advanceTimersByTimeAsync(milliseconds),
    runAllTimers: () => vi.runAllTimers(),
    runAllTimersAsync: () => vi.runAllTimersAsync(),
    clearAllTimers: () => vi.clearAllTimers(),
  }
}
