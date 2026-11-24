/** Grabs a lightweight poster frame from a finished recording. */
export function createPoster(url: string, maxWidth = 480): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), 4000);

    const draw = () => {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) {
          finish(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(maxWidth, width);
        canvas.height = Math.max(1, Math.round((canvas.width / width) * height));
        const context = canvas.getContext('2d');
        if (!context) {
          finish(null);
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        finish(null);
      }
    };

    video.addEventListener('loadeddata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 1;
      try {
        video.currentTime = Math.min(0.25, Math.max(0.05, duration * 0.1));
      } catch {
        draw();
      }
    }, { once: true });

    video.addEventListener('seeked', draw, { once: true });
    video.addEventListener('error', () => finish(null), { once: true });
    video.src = url;
  });
}
