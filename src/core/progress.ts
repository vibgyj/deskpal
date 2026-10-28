/**
 * Sums download progress across model files against the expected total, so
 * the bar moves steadily instead of jumping back as new files are discovered.
 */
export class DownloadProgress {
  private files = new Map<string, number>();
  private expectedBytes: number;
  private onChange: (fraction: number) => void;

  constructor(expectedMB: number, onChange: (fraction: number) => void) {
    this.expectedBytes = Math.max(1, expectedMB * 1e6);
    this.onChange = onChange;
  }

  update = (key: string, loaded: number, _total: number): void => {
    this.files.set(key, loaded);
    let sum = 0;
    for (const b of this.files.values()) sum += b;
    this.onChange(Math.min(1, sum / this.expectedBytes));
  };
}
