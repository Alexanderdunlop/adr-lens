import { useEffect, useState } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
}

function read(): TerminalSize {
  return {
    columns: Math.max(60, process.stdout.columns ?? 80),
    rows: Math.max(12, process.stdout.rows ?? 24),
  };
}

/** Track terminal dimensions so the panes re-layout when the window changes. */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(read);

  useEffect(() => {
    const onResize = (): void => setSize(read());
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}
