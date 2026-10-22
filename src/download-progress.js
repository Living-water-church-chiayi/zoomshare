'use strict';

// Machine-readable yt-dlp progress. Each stream has its own line buffer;
// byte estimates, retries and resumed fragments may change but displayed work
// never moves backwards within one request.
class DownloadProgress {
  constructor(report) {
    this.report = report;
    this.percent = 0;
    this.formats = [];
    this.completed = new Map();
    this.downloaded = new Map();
    this.buffers = new Map();
  }

  emit(percent, phase, details = {}) {
    this.percent = Math.max(this.percent, Math.max(0, Math.min(100, Number(percent) || 0)));
    this.report(this.percent, phase, details);
  }

  consume(chunk, stream = 'stdout') {
    const text = (this.buffers.get(stream) || '') + String(chunk);
    const lines = text.split(/\r?\n|\r/);
    this.buffers.set(stream, lines.pop().slice(-128 * 1024));
    for (const line of lines) this.line(line);
  }

  line(line) {
    try {
      if (line.startsWith('__LINGXIU_FORMATS__')) {
        const formats = JSON.parse(line.slice('__LINGXIU_FORMATS__'.length));
        this.formats = (Array.isArray(formats) ? formats : []).map((format) => ({
          id: String(format.format_id),
          bytes: Number(format.filesize || format.filesize_approx) || 0
        }));
        return;
      }
      if (line.startsWith('__LINGXIU_PROGRESS__')) {
        const data = JSON.parse(line.slice('__LINGXIU_PROGRESS__'.length));
        const id = String(data.format_id);
        if (!this.formats.some((format) => format.id === id)) this.formats.push({ id, bytes: Number(data.total || data.estimate) || 0 });
        const total = Number(data.total);
        const fragmentCount = Number(data.fragment_count);
        const fragmentIndex = Number(data.fragment_index);
        const hasFragments = fragmentCount > 0 && data.fragment_index != null && Number.isFinite(fragmentIndex);
        // HLS starts with a tiny initialization fragment. Its first byte estimate
        // can equal the bytes already received, falsely implying 100% completion.
        // Count completed fragments instead; only trust exact totals for HTTP.
        const fraction = data.status === 'finished' ? 1 : hasFragments
          ? Math.min(.999, Math.max(0, fragmentIndex / fragmentCount))
          : total > 0 ? Math.min(.999, Number(data.downloaded) / total) : 0;
        this.completed.set(id, Math.max(this.completed.get(id) || 0, fraction || 0));
        this.downloaded.set(id, Math.max(this.downloaded.get(id) || 0, Number(data.downloaded) || 0));
        const knownSizes = this.formats.every((format) => format.bytes > 0);
        const weight = (format) => knownSizes ? format.bytes : 1;
        const work = this.formats.reduce((sum, format) => sum + weight(format) * (this.completed.get(format.id) || 0), 0);
        const size = this.formats.reduce((sum, format) => sum + weight(format), 0);
        this.emit(98 * work / Math.max(size, 1), 'download', {
          downloadedBytes: this.formats.reduce((sum, format) => sum + (this.downloaded.get(format.id) || 0), 0),
          fragmentIndex: hasFragments ? Math.min(fragmentCount, Math.max(0, fragmentIndex)) : null,
          fragmentCount: hasFragments ? fragmentCount : null
        });
        return;
      }
      if (/\[Merger\]|\[ExtractAudio\]/.test(line)) this.emit(99, 'merge');
      else if (/\[info\]\s+Testing format|Checking format/i.test(line) && !this.percent) this.emit(0, 'check');
      else if (/\[youtube\].*(Extracting URL|Downloading|Solving JS challenges)/i.test(line) && !this.percent) this.emit(0, 'extract');
    } catch { /* Unrelated diagnostic lines must not affect download progress. */ }
  }

  flush() {
    for (const [stream, line] of this.buffers) {
      if (line) this.line(line);
      this.buffers.delete(stream);
    }
  }
}

module.exports = { DownloadProgress };
