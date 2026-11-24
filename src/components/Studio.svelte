<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Toggle from './Toggle.svelte';
  import { RecorderEngine } from '../lib/recorder/engine';
  import { createFileSink, pickRecordingFile, type SaveFileHandle } from '../lib/recorder/sink';
  import {
    FRAME_RATES,
    QUALITIES,
    SIZE_PRESETS,
    bitrateFor,
    estimateBytesPerMinute,
    formatBitrate,
    formatBytes,
    formatDuration,
    formatTakeDuration,
    makeFilename,
  } from '../lib/recorder/presets';
  import {
    DEFAULT_SETTINGS,
    describeFormat,
    detectSupport,
    suggestedExtension,
    type SupportReport,
  } from '../lib/recorder/support';
  import type {
    CaptureSource,
    Destination,
    OutputFormat,
    RecorderSnapshot,
    RecordingTake,
    Settings,
  } from '../lib/recorder/types';

  const SOURCES: Array<{ id: CaptureSource; label: string; icon: string }> = [
    { id: 'screen', label: 'Screen', icon: 'screen' },
    { id: 'window', label: 'Window', icon: 'window' },
    { id: 'tab', label: 'Tab', icon: 'tab' },
    { id: 'ask', label: 'Ask me', icon: 'any' },
  ];

  const COUNTDOWNS = [
    { value: 0, label: 'Off' },
    { value: 3, label: '3s' },
    { value: 5, label: '5s' },
  ];

  const INITIAL: RecorderSnapshot = {
    status: 'idle',
    elapsedMs: 0,
    countdown: null,
    bytes: 0,
    error: null,
    notice: null,
    live: null,
    previewStream: null,
    micLevel: 0,
    systemLevel: 0,
    micMuted: false,
    sinkName: null,
    take: null,
  };

  let engine = $state.raw<RecorderEngine | null>(null);
  let snapshot = $state<RecorderSnapshot>({ ...INITIAL });
  let support = $state<SupportReport | null>(null);
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  let takes = $state<RecordingTake[]>([]);
  let saveHandle = $state.raw<SaveFileHandle | null>(null);
  let saveHandleName = $state<string | null>(null);
  let isPickingFile = $state(false);
  let fileError = $state<string | null>(null);
  let stageVideo = $state<HTMLVideoElement | null>(null);
  let downloadedId = $state<string | null>(null);

  const status = $derived(snapshot.status);
  const isRecording = $derived(status === 'recording');
  const isPaused = $derived(status === 'paused');
  const isBusy = $derived(
    status === 'requesting'
    || status === 'countdown'
    || status === 'recording'
    || status === 'paused'
    || status === 'stopping',
  );
  const currentTake = $derived(status === 'ready' ? snapshot.take : null);
  const anyAudio = $derived(settings.systemAudio || settings.microphone);
  const bitrate = $derived(
    bitrateFor(settings.width, settings.height, settings.frameRate, settings.quality, anyAudio),
  );
  const bytesPerMinute = $derived(
    estimateBytesPerMinute(settings.width, settings.height, settings.frameRate, settings.quality, anyAudio),
  );
  const formatText = $derived(describeFormat(settings.format, support));
  const selectedSize = $derived(
    settings.customSize
      ? 'custom'
      : SIZE_PRESETS.find((preset) => preset.width === settings.width && preset.height === settings.height)?.id
        ?? 'custom',
  );
  const qualityLabel = $derived(
    QUALITIES.find((entry) => entry.id === settings.quality)?.label ?? 'Balanced',
  );
  const sizeSummary = $derived(
    settings.customSize || settings.width > 0
      ? `${settings.width || 0} × ${settings.height || 0} max`
      : 'Native size',
  );
  const statusLabel = $derived(
    status === 'idle'
      ? 'STANDBY'
      : status === 'requesting'
        ? 'WAITING'
        : status === 'countdown'
          ? 'ARMED'
          : status === 'recording'
            ? 'RECORDING'
            : status === 'paused'
              ? 'PAUSED'
              : status === 'stopping'
                ? 'SAVING'
                : status === 'ready'
                  ? 'TAKE READY'
                  : 'ERROR',
  );
  const busyLabel = $derived(
    status === 'requesting'
      ? 'Waiting for the picker'
      : status === 'countdown'
        ? 'Starting'
        : status === 'paused'
          ? 'Paused'
          : status === 'stopping'
            ? 'Finishing the file'
            : 'Recording',
  );
  const primaryLabel = $derived(
    settings.destination === 'disk' && !saveHandle
      ? 'Choose destination file'
      : status === 'ready'
        ? 'Record another'
        : 'Start recording',
  );
  const liveResolution = $derived(
    snapshot.live
      ? `${snapshot.live.width} × ${snapshot.live.height}`
      : sizeSummary,
  );
  const liveFrameRate = $derived(snapshot.live?.frameRate ?? settings.frameRate);
  const announcement = $derived(
    status === 'recording'
      ? 'Recording started.'
      : status === 'paused'
        ? 'Recording paused.'
        : status === 'ready'
          ? 'Recording ready to save.'
          : status === 'error'
            ? snapshot.error ?? 'Recording failed.'
            : '',
  );

  onMount(() => {
    support = detectSupport();

    const instance = new RecorderEngine({
      onUpdate: (next) => {
        snapshot = next;
      },
      onTake: (take) => {
        takes = [take, ...takes];
      },
    });

    engine = instance;
    snapshot = instance.getSnapshot();

    if (!instance) return;

    return () => {
      void instance.destroy();
      for (const take of takes) URL.revokeObjectURL(take.url);
    };
  });

  // Keep the live preview attached to the <video> element.
  $effect(() => {
    const element = stageVideo;
    if (!element) return;
    const stream = snapshot.previewStream;
    if (element.srcObject !== stream) {
      element.srcObject = stream;
      if (stream) {
        void element.play().catch(() => undefined);
      }
    }
  });

  // Warn before a reload or tab close destroys an in-flight take.
  $effect(() => {
    if (!isBusy) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeSize(): void {
    if (!settings.customSize) return;
    settings.width = clamp(Math.round(Number(settings.width) || 1920), 320, 7680);
    settings.height = clamp(Math.round(Number(settings.height) || 1080), 240, 4320);
  }

  function selectSize(preset: (typeof SIZE_PRESETS)[number]): void {
    settings.customSize = false;
    settings.width = preset.width;
    settings.height = preset.height;
  }

  function selectCustomSize(): void {
    if (settings.customSize) return;
    settings.customSize = true;
    if (!settings.width) {
      settings.width = 1920;
      settings.height = 1080;
    }
  }

  function setFormat(format: OutputFormat): void {
    if (settings.format === format) return;
    settings.format = format;
    if (saveHandle) {
      saveHandle = null;
      saveHandleName = null;
      fileError = 'Format changed — choose a destination file again.';
    }
  }

  function resetSettings(): void {
    settings = { ...DEFAULT_SETTINGS };
    saveHandle = null;
    saveHandleName = null;
    fileError = null;
  }

  async function chooseFile(): Promise<void> {
    if (!support?.fileSystemAccess) return;
    isPickingFile = true;
    fileError = null;
    try {
      const extension = suggestedExtension(settings.format);
      const handle = await pickRecordingFile(extension, makeFilename(new Date(), extension));
      if (handle) {
        saveHandle = handle;
        saveHandleName = handle.name;
        settings.destination = 'disk';
      } else if (!saveHandle) {
        settings.destination = 'memory';
      }
    } catch (error) {
      const message = (error as Error | undefined)?.message;
      fileError = message ? `Could not open that file: ${message}` : 'Could not open the save dialog.';
      if (!saveHandle) settings.destination = 'memory';
    } finally {
      isPickingFile = false;
    }
  }

  function setDestination(destination: Destination): void {
    if (destination === 'disk' && !support?.fileSystemAccess) return;
    settings.destination = destination;
    if (destination === 'disk' && !saveHandle) {
      void chooseFile();
    }
  }

  async function startRecording(): Promise<void> {
    if (!engine || !support?.ready || isBusy) return;
    normalizeSize();
    fileError = null;

    if (settings.destination === 'disk' && !saveHandle) {
      await chooseFile();
      return;
    }

    const handle = saveHandle;
    await engine.start({
      source: settings.source,
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      quality: settings.quality,
      format: settings.format,
      cursor: settings.cursor,
      systemAudio: settings.systemAudio,
      microphone: settings.microphone,
      countdown: settings.countdown,
      destination: settings.destination,
      ...(settings.destination === 'disk' && handle
        ? { sinkFactory: () => createFileSink(handle) }
        : {}),
    });
  }

  function primaryAction(): void {
    if (isBusy) return;
    void startRecording();
  }

  function togglePause(): void {
    if (!engine) return;
    if (isPaused) engine.resume();
    else engine.pause();
  }

  function stopRecording(): void {
    void engine?.stop();
  }

  function toggleMic(): void {
    engine?.setMicMuted(!snapshot.micMuted);
  }

  function cancelCountdown(): void {
    engine?.cancelCountdown();
  }

  function downloadTake(take: RecordingTake): void {
    const anchor = document.createElement('a');
    anchor.href = take.url;
    anchor.download = take.name;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    downloadedId = take.id;
    window.setTimeout(() => {
      if (downloadedId === take.id) downloadedId = null;
    }, 2400);
  }

  function removeTake(take: RecordingTake): void {
    takes = takes.filter((entry) => entry.id !== take.id);
    URL.revokeObjectURL(take.url);
    if (snapshot.take?.id === take.id) engine?.dismissTake();
  }

  function fixDuration(event: Event): void {
    const video = event.currentTarget as HTMLVideoElement;
    if (Number.isFinite(video.duration)) return;
    const onTimeUpdate = () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.currentTime = 0;
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    video.currentTime = 1e101;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;

    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      if (isPaused) engine?.resume();
      else if (!isBusy) primaryAction();
    } else if (key === 'p') {
      if (isRecording || isPaused) {
        event.preventDefault();
        togglePause();
      }
    } else if (key === 's') {
      if (isRecording || isPaused) {
        event.preventDefault();
        stopRecording();
      }
    } else if (key === 'm') {
      if (snapshot.live?.hasMicrophone && (isRecording || isPaused)) {
        event.preventDefault();
        toggleMic();
      }
    } else if (key === 'd') {
      const latest = snapshot.take ?? takes[0];
      if (latest && !isBusy) {
        event.preventDefault();
        downloadTake(latest);
      }
    } else if (key === 'escape') {
      if (status === 'countdown') {
        event.preventDefault();
        cancelCountdown();
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="studio" id="recorder">
  <div class="studio-chrome">
    <div class="chrome-group">
      <span class="chrome-led" class:active={isRecording} class:paused={isPaused}></span>
      <span class="mono">STUDIO 01</span>
      <span class="chrome-sep">/</span>
      <span class="mono" class:rec-text={isRecording}>{statusLabel}</span>
    </div>
    <div class="chrome-group right">
      {#if isBusy && snapshot.live}
        <span class="mono dim">{snapshot.live.width}×{snapshot.live.height}</span>
        <span class="chrome-sep">·</span>
        <span class="mono dim">{snapshot.live.frameRate} FPS</span>
      {:else}
        <span class="mono dim">LOCAL ONLY</span>
        {#if !isBusy}
          <button type="button" class="chrome-record" onclick={primaryAction} disabled={!support?.ready}>
            <span class="chrome-rec-dot" aria-hidden="true"></span>
            Record
          </button>
        {/if}
      {/if}
    </div>
  </div>

  <div class="studio-body">
    <div class="stage">
      <div class="stage-view" class:is-live={isBusy}>
        {#if currentTake}
          <div class="player-wrap">
            <div
              class="player-frame"
              style={`--ar: ${currentTake.width > 0 && currentTake.height > 0 ? (currentTake.width / currentTake.height).toFixed(4) : '1.7778'}`}
            >
              <video
                class="player"
                src={currentTake.url}
                poster={currentTake.posterUrl ?? undefined}
                controls
                playsinline
                preload="metadata"
                onloadedmetadata={fixDuration}
              ></video>
            </div>
            <span class="take-badge mono"><span class="badge-dot"></span>TAKE {String(takes.length).padStart(2, '0')} READY</span>
          </div>
        {:else if snapshot.previewStream}
          <video class="stage-video" bind:this={stageVideo} muted playsinline></video>

          <div class="hud">
            <span class="hud-chip rec"><span class="pulse-dot" class:paused={isPaused}></span>{isPaused ? 'PAUSED' : status === 'countdown' ? 'ARMED' : 'REC'}</span>
            <span class="hud-chip mono">{liveResolution}</span>
            <span class="hud-chip mono">{liveFrameRate} FPS</span>
            {#if snapshot.live?.hasMicrophone}
              <span class="hud-chip mono" class:muted={snapshot.micMuted}><Icon name={snapshot.micMuted ? 'mic-off' : 'mic'} size={11} />{snapshot.micMuted ? 'MUTED' : 'MIC'}</span>
            {/if}
            {#if snapshot.live?.hasSystemAudio}
              <span class="hud-chip mono"><Icon name="speaker" size={11} />SYS</span>
            {/if}
          </div>

          {#if status === 'countdown' && snapshot.countdown !== null}
            <div class="countdown-layer">
              <p class="countdown-label mono">STARTING IN</p>
              <p class="countdown-number">{snapshot.countdown === 0 ? 'GO' : snapshot.countdown}</p>
              <button type="button" class="btn ghost small" onclick={cancelCountdown}>Cancel <kbd>Esc</kbd></button>
            </div>
          {/if}

          {#if isPaused}
            <div class="paused-layer" aria-hidden="true">
              <Icon name="pause" size={26} />
              <span class="mono">PAUSED</span>
            </div>
          {/if}

          {#if status === 'stopping'}
            <div class="countdown-layer">
              <span class="spinner large"></span>
              <p class="saving-label">Finishing the file…</p>
              <p class="saving-hint">Writing the last chunks and pulling a preview frame.</p>
            </div>
          {/if}

          {#if (isRecording || isPaused) && snapshot.notice}
            <p class="stage-notice"><Icon name="alert" size={12} />{snapshot.notice}</p>
          {/if}

          {#if isRecording || isPaused}
            <div class="dock">
              <div class="dock-timer">
                <span class="pulse-dot" class:paused={isPaused}></span>
                <span class="mono timer">{formatDuration(snapshot.elapsedMs, true)}</span>
                <span class="dock-size mono" class:heavy={snapshot.bytes > 750 * 1024 * 1024}>{formatBytes(snapshot.bytes)}</span>
                {#if isPaused}<span class="dock-tag mono">PAUSED</span>{/if}
                {#if snapshot.sinkName}<span class="dock-sink mono" title={snapshot.sinkName}><Icon name="disk" size={11} />{snapshot.sinkName}</span>{/if}
              </div>
              <div class="dock-actions">
                {#if snapshot.live?.hasMicrophone}
                  <button
                    type="button"
                    class="icon-btn"
                    class:muted={snapshot.micMuted}
                    aria-pressed={snapshot.micMuted}
                    aria-label={snapshot.micMuted ? 'Unmute microphone' : 'Mute microphone'}
                    title={snapshot.micMuted ? 'Unmute microphone (M)' : 'Mute microphone (M)'}
                    onclick={toggleMic}
                  >
                    <Icon name={snapshot.micMuted ? 'mic-off' : 'mic'} size={15} />
                    <span class="meter" aria-hidden="true">
                      <span class="bar" class:on={!snapshot.micMuted && snapshot.micLevel > 0.06}></span>
                      <span class="bar" class:on={!snapshot.micMuted && snapshot.micLevel > 0.18}></span>
                      <span class="bar" class:on={!snapshot.micMuted && snapshot.micLevel > 0.34}></span>
                    </span>
                  </button>
                {/if}
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                  title={isPaused ? 'Resume (P)' : 'Pause (P)'}
                  onclick={togglePause}
                >
                  <Icon name={isPaused ? 'play' : 'pause'} size={15} />
                </button>
                <button type="button" class="stop-btn" onclick={stopRecording} title="Stop (S)">
                  <span class="stop-square" aria-hidden="true"></span>
                  Stop
                </button>
              </div>
            </div>
          {/if}
        {:else if status === 'requesting'}
          <div class="idle">
            <span class="spinner"></span>
            <p class="idle-label mono">WAITING FOR THE PICKER</p>
            <h2>Choose what to share.</h2>
            <p class="idle-copy">Pick a screen, window or tab in the browser dialog. The take begins once you are back here.</p>
            <p class="idle-hint mono">share picker → countdown → recording</p>
          </div>
        {:else if status === 'stopping'}
          <div class="idle">
            <span class="spinner"></span>
            <p class="idle-label mono">SAVING</p>
            <h2>Finishing the file…</h2>
            <p class="idle-copy">Writing the last chunks and pulling a preview frame.</p>
          </div>
        {:else if status === 'error'}
          <div class="idle">
            <span class="state-icon error"><Icon name="alert" size={24} /></span>
            <p class="idle-label mono">NO TAKE</p>
            <h2>That didn't record.</h2>
            <p class="idle-copy" role="alert">{snapshot.error ?? 'Something interrupted the recording.'}</p>
            <div class="idle-actions">
              <button type="button" class="btn primary" onclick={primaryAction}>Try again</button>
            </div>
          </div>
        {:else if support && !support.ready}
          <div class="idle">
            <span class="state-icon warn"><Icon name="alert" size={24} /></span>
            <p class="idle-label mono">NOT AVAILABLE</p>
            <h2>This browser can't capture a screen.</h2>
            <p class="idle-copy">
              {#if !support.secureContext}
                Screen capture needs a secure context — open this page over HTTPS or on localhost.
              {:else if support.mobile}
                Mobile browsers don't expose screen capture. Use a desktop browser instead.
              {:else}
                Try desktop Chrome, Edge, Firefox or Safari 18.4+. Screen capture and MediaRecorder are both required.
              {/if}
            </p>
          </div>
        {:else}
          <div class="idle">
            <div class="idle-mark" aria-hidden="true">
              <span class="corner tl"></span>
              <span class="corner tr"></span>
              <span class="corner bl"></span>
              <span class="corner br"></span>
              <span class="idle-rec"><span></span></span>
            </div>
            <p class="idle-label mono">STANDBY</p>
            <h2>No signal. Yet.</h2>
            <p class="idle-copy">
              Pick a screen, window or tab, choose your size, and Tape will record it right here.
              Nothing is uploaded, watermarked or sent anywhere.
            </p>
            <div class="idle-actions">
              <button type="button" class="btn primary" onclick={primaryAction} disabled={!support?.ready || isBusy}>
                <span class="btn-dot" aria-hidden="true"></span>
                {primaryLabel}
              </button>
              <span class="kbd-hint mono">press <kbd>R</kbd></span>
            </div>
            {#if support?.mobile}
              <p class="idle-hint">Screen capture is a desktop feature — this page will not work on mobile.</p>
            {/if}
          </div>
        {/if}
      </div>

      {#if currentTake}
        <div class="take-bar">
          <div class="take-copy">
            <span class="take-name mono" title={currentTake.name}>{currentTake.name}</span>
            <span class="take-meta mono">
              {formatTakeDuration(currentTake.durationMs)}
              <span class="meta-sep">·</span>
              {formatBytes(currentTake.size)}
              <span class="meta-sep">·</span>
              {currentTake.width > 0 ? `${currentTake.width}×${currentTake.height}` : 'size unknown'}
              <span class="meta-sep">·</span>
              {currentTake.extension.toUpperCase()}
              {#if currentTake.destination === 'disk'}
                <span class="meta-sep">·</span>
                on disk
              {/if}
            </span>
          </div>
          <div class="take-actions">
            <button type="button" class="btn ghost icon-only" aria-label="Delete this take" title="Delete this take" onclick={() => removeTake(currentTake)}>
              <Icon name="trash" size={15} />
            </button>
            <button type="button" class="btn primary" onclick={() => downloadTake(currentTake)}>
              <Icon name={downloadedId === currentTake.id ? 'check' : 'download'} size={15} />
              {downloadedId === currentTake.id
                ? 'Saved'
                : currentTake.destination === 'disk'
                  ? 'Download a copy'
                  : 'Save video'}
            </button>
          </div>
        </div>
      {/if}
    </div>

    <aside class="settings" aria-label="Recorder setup">
      <div class="settings-head">
        <span class="group-label mono">Setup</span>
        <button type="button" class="reset-btn" disabled={isBusy} onclick={resetSettings}>Reset</button>
      </div>

      <fieldset class="fields" disabled={isBusy} aria-label="Recording settings">
        <div class="settings-scroll">
          <section class="group">
            <div class="group-head">
              <span class="group-label mono">Capture</span>
              <span class="group-hint">what to share</span>
            </div>

            <div class="source-grid">
              {#each SOURCES as source (source.id)}
                <button
                  type="button"
                  class="source"
                  class:selected={settings.source === source.id}
                  aria-pressed={settings.source === source.id}
                  onclick={() => (settings.source = source.id)}
                >
                  <Icon name={source.icon} size={15} />
                  <span>{source.label}</span>
                </button>
              {/each}
            </div>
            <p class="micro">A hint for the picker — you always choose the surface yourself.</p>

            <div class="rows">
              <div class="row">
                <div class="row-copy">
                  <span class="row-label">System audio</span>
                  <span class="row-hint">Tab, window or desktop sound</span>
                </div>
                <Toggle
                  checked={settings.systemAudio}
                  label="Record system audio"
                  onchange={(value) => (settings.systemAudio = value)}
                />
              </div>
              <div class="row">
                <div class="row-copy">
                  <span class="row-label">Microphone</span>
                  <span class="row-hint">Narration, mixed with the rest</span>
                </div>
                <Toggle
                  checked={settings.microphone}
                  label="Record microphone"
                  onchange={(value) => (settings.microphone = value)}
                />
              </div>
              <div class="row">
                <div class="row-copy">
                  <span class="row-label">Countdown</span>
                  <span class="row-hint">Before the take begins</span>
                </div>
                <div class="seg mini">
                  {#each COUNTDOWNS as option (option.value)}
                    <button
                      type="button"
                      class:on={settings.countdown === option.value}
                      onclick={() => (settings.countdown = option.value)}
                    >{option.label}</button>
                  {/each}
                </div>
              </div>
            </div>
          </section>

          <section class="group">
            <div class="group-head">
              <span class="group-label mono">Output</span>
              <span class="group-hint">size is a ceiling</span>
            </div>

            <div class="size-grid">
              {#each SIZE_PRESETS as preset (preset.id)}
                <button
                  type="button"
                  class="size"
                  class:selected={selectedSize === preset.id}
                  aria-pressed={selectedSize === preset.id}
                  onclick={() => selectSize(preset)}
                >
                  <span class="size-label">{preset.label}</span>
                  <span class="size-detail mono">{preset.id === 'source' ? 'Native' : `${preset.width}×${preset.height}`}</span>
                </button>
              {/each}
              <button
                type="button"
                class="size"
                class:selected={selectedSize === 'custom'}
                aria-pressed={selectedSize === 'custom'}
                onclick={selectCustomSize}
              >
                <span class="size-label">Custom</span>
                <span class="size-detail mono">{settings.customSize ? `${settings.width}×${settings.height}` : 'W × H'}</span>
              </button>
            </div>

            {#if settings.customSize}
              <div class="custom-size">
                <label>
                  Width
                  <input
                    type="number"
                    min="320"
                    max="7680"
                    step="2"
                    value={settings.width}
                    oninput={(event) => (settings.width = Number(event.currentTarget.value) || 0)}
                    onblur={normalizeSize}
                  />
                </label>
                <span class="times">×</span>
                <label>
                  Height
                  <input
                    type="number"
                    min="240"
                    max="4320"
                    step="2"
                    value={settings.height}
                    oninput={(event) => (settings.height = Number(event.currentTarget.value) || 0)}
                    onblur={normalizeSize}
                  />
                </label>
              </div>
            {/if}
            <p class="micro">Scaled to fit inside this box — aspect ratio preserved, never cropped.</p>

            <div class="rows">
              <div class="row">
                <div class="row-copy">
                  <span class="row-label">Frame rate</span>
                  <span class="row-hint">30 is plenty for UI</span>
                </div>
                <div class="seg mini">
                  {#each FRAME_RATES as rate (rate)}
                    <button
                      type="button"
                      class:on={settings.frameRate === rate}
                      onclick={() => (settings.frameRate = rate)}
                    >{rate}</button>
                  {/each}
                </div>
              </div>
              <div class="row">
                <div class="row-copy">
                  <span class="row-label">Cursor</span>
                  <span class="row-hint">Draw the pointer into the video</span>
                </div>
                <Toggle
                  checked={settings.cursor === 'always'}
                  label="Show cursor in recording"
                  onchange={(value) => (settings.cursor = value ? 'always' : 'never')}
                />
              </div>
            </div>

            <div class="dual">
              <div class="stack">
                <span class="row-label">Quality</span>
                <div class="seg block">
                  {#each QUALITIES as entry (entry.id)}
                    <button
                      type="button"
                      class:on={settings.quality === entry.id}
                      onclick={() => (settings.quality = entry.id)}
                    >{entry.label}</button>
                  {/each}
                </div>
              </div>
              <div class="stack">
                <span class="row-label">Format</span>
                <div class="seg block">
                  <button
                    type="button"
                    class:on={settings.format === 'auto'}
                    onclick={() => setFormat('auto')}
                  >Auto</button>
                  <button
                    type="button"
                    class:on={settings.format === 'mp4'}
                    disabled={!support?.mp4}
                    onclick={() => setFormat('mp4')}
                  >MP4</button>
                  <button
                    type="button"
                    class:on={settings.format === 'webm'}
                    disabled={!support?.webm}
                    onclick={() => setFormat('webm')}
                  >WebM</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </fieldset>

      <div class="panel-footer">
        {#if !isBusy}
          <div class="save-line">
            <span class="save-label mono">Save</span>
            <div class="seg mini">
              <button
                type="button"
                class:on={settings.destination === 'memory'}
                onclick={() => setDestination('memory')}
              >In memory</button>
              <button
                type="button"
                class:on={settings.destination === 'disk'}
                disabled={!support?.fileSystemAccess}
                title={!support?.fileSystemAccess ? 'Writing to disk needs Chrome or Edge' : undefined}
                onclick={() => setDestination('disk')}
              >To disk</button>
            </div>
            {#if settings.destination === 'disk'}
              <button
                type="button"
                class="file-pill mono"
                disabled={isPickingFile}
                onclick={chooseFile}
                title={saveHandleName ?? 'Choose a destination file'}
              >
                <Icon name="disk" size={12} />
                <span>{isPickingFile ? 'Opening…' : saveHandleName ?? 'Choose file…'}</span>
              </button>
            {/if}
          </div>
          {#if fileError}
            <p class="error-line" role="alert">{fileError}</p>
          {/if}
        {/if}

        <div class="estimate">
          <span class="mono">{formatBitrate(bitrate)}</span>
          <span class="sep">·</span>
          <span class="mono">≈ {formatBytes(bytesPerMinute)}/min</span>
        </div>
        <p class="estimate-sub">{sizeSummary} · {settings.frameRate} fps · {qualityLabel} · {formatText}</p>

        {#if isBusy}
          <div class="live-strip">
            <span class="pulse-dot" class:paused={isPaused}></span>
            <span>{busyLabel}</span>
            <span class="mono">{formatDuration(snapshot.elapsedMs, true)}</span>
          </div>
        {:else}
          <button type="button" class="start-btn" onclick={primaryAction} disabled={!support?.ready}>
            <span class="start-dot" aria-hidden="true"></span>
            <span>{primaryLabel}</span>
            <span class="start-kbd mono">R</span>
          </button>
        {/if}
      </div>
    </aside>
  </div>
</div>

{#if takes.length > 0}
  <section class="takes" aria-label="Recordings from this session">
    <div class="takes-head">
      <h2>Takes</h2>
      <span class="mono">THIS TAB ONLY · {takes.length}</span>
    </div>
    <ul class="take-list">
      {#each takes as take (take.id)}
        <li class="take-item" class:current={snapshot.take?.id === take.id}>
          <div class="thumb">
            {#if take.posterUrl}
              <img src={take.posterUrl} alt="" />
            {:else}
              <Icon name="film" size={16} />
            {/if}
          </div>
          <div class="take-info">
            <span class="take-file mono" title={take.name}>{take.name}</span>
            <span class="take-sub mono">
              {formatTakeDuration(take.durationMs)} · {formatBytes(take.size)}
              {#if take.width > 0} · {take.width}×{take.height}{/if}
              · {take.extension.toUpperCase()}
            </span>
          </div>
          <div class="take-item-actions">
            <button type="button" class="icon-btn plain" aria-label={`Save ${take.name}`} title="Save video" onclick={() => downloadTake(take)}>
              <Icon name={downloadedId === take.id ? 'check' : 'download'} size={15} />
            </button>
            <button type="button" class="icon-btn plain danger" aria-label={`Delete ${take.name}`} title="Delete take" onclick={() => removeTake(take)}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<div class="shortcuts" aria-label="Keyboard shortcuts">
  <span class="mono label">Shortcuts</span>
  <span><kbd>R</kbd> start / resume</span>
  <span><kbd>P</kbd> pause</span>
  <span><kbd>S</kbd> stop</span>
  <span><kbd>M</kbd> mute mic</span>
  <span><kbd>D</kbd> download last</span>
  <span><kbd>Esc</kbd> cancel countdown</span>
</div>

<p class="sr-only" aria-live="polite">{announcement}</p>

<style>
  .studio {
    position: relative;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: linear-gradient(180deg, #12151a, #0b0d11 70%);
    box-shadow:
      0 30px 90px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    overflow: hidden;
  }

  .studio::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 75, 62, 0.55), transparent);
    opacity: 0.7;
    z-index: 2;
    pointer-events: none;
  }

  .studio-chrome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 40px;
    padding: 0 16px;
    border-bottom: 1px solid var(--line-soft);
    background: rgba(255, 255, 255, 0.015);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .chrome-group {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .chrome-group.right {
    gap: 6px;
  }

  .chrome-sep {
    color: #3a3f48;
  }

  .chrome-led {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #3d424b;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.02);
  }

  .chrome-led.active {
    background: var(--rec);
    box-shadow: 0 0 8px rgba(255, 75, 62, 0.75);
    animation: blink 1.6s ease-in-out infinite;
  }

  .chrome-led.paused {
    background: var(--warn);
    animation: none;
  }

  .chrome-record {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 23px;
    margin-left: 3px;
    padding: 0 8px;
    border-radius: 5px;
    background: var(--rec);
    color: #170403;
    font-size: 8.5px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: background 0.16s var(--ease);
  }

  .chrome-record:hover:not(:disabled) {
    background: var(--rec-bright);
  }

  .chrome-record:disabled {
    opacity: 0.35;
  }

  .chrome-rec-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .rec-text {
    color: var(--rec-bright);
  }

  .dim {
    color: #5f646d;
  }

  .studio-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 384px;
    height: 760px;
  }

  .stage {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .stage-view {
    position: relative;
    flex: 1;
    min-height: 0;
    container-type: size;
    background:
      radial-gradient(1000px 500px at 50% 42%, rgba(255, 255, 255, 0.035), transparent 70%),
      #07080a;
    overflow: hidden;
  }

  .stage-view::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 48px 48px;
    -webkit-mask-image: radial-gradient(ellipse at 50% 50%, black 10%, transparent 75%);
    mask-image: radial-gradient(ellipse at 50% 50%, black 10%, transparent 75%);
    z-index: 0;
  }

  .stage-view.is-live::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 1px rgba(255, 75, 62, 0.32),
      inset 0 0 70px rgba(255, 75, 62, 0.07);
  }

  .stage-video,
  .player {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #000;
    object-fit: contain;
    z-index: 1;
  }

  .player-wrap {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  .player-frame {
    position: relative;
    width: 100%;
    width: min(100%, calc(100cqh * var(--ar, 1.7778)));
    max-height: 100%;
    aspect-ratio: var(--ar, 1.7778);
    background: #000;
  }

  .player {
    position: absolute;
    inset: 0;
  }

  .take-badge {
    position: absolute;
    top: 14px;
    left: 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(8, 9, 11, 0.72);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    font-size: 8.5px;
    letter-spacing: 0.12em;
    color: var(--ok);
    z-index: 4;
    pointer-events: none;
  }

  .badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 7px rgba(140, 224, 176, 0.6);
  }

  .hud {
    position: absolute;
    top: 14px;
    left: 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    z-index: 4;
    pointer-events: none;
  }

  .hud-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 7px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 5px;
    background: rgba(8, 9, 11, 0.7);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    font-size: 8.5px;
    line-height: 1;
    letter-spacing: 0.06em;
    color: #c9ccd2;
    text-transform: uppercase;
  }

  .hud-chip.rec {
    color: #ffd4d0;
    border-color: rgba(255, 75, 62, 0.35);
    background: rgba(255, 75, 62, 0.16);
  }

  .hud-chip.muted {
    color: var(--warn);
  }

  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--rec);
    box-shadow: 0 0 8px rgba(255, 75, 62, 0.65);
    animation: blink 1.6s ease-in-out infinite;
  }

  .pulse-dot.paused {
    background: var(--warn);
    box-shadow: 0 0 8px rgba(240, 195, 122, 0.5);
    animation: none;
  }

  .dock {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 9px 8px 14px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    background: rgba(9, 10, 13, 0.84);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }

  .dock-timer {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .timer {
    font-size: 18px;
    letter-spacing: 0.01em;
    color: var(--text);
  }

  .dock-tag {
    font-size: 8px;
    letter-spacing: 0.1em;
    padding: 2px 5px;
    border-radius: 4px;
    background: rgba(240, 195, 122, 0.14);
    color: var(--warn);
  }

  .dock-size {
    font-size: 8.5px;
    color: var(--text-faint);
    padding-left: 7px;
    margin-left: 1px;
    border-left: 1px solid var(--line);
  }

  .dock-size.heavy {
    color: var(--warn);
  }

  .dock-sink {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 150px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 8.5px;
    color: var(--text-faint);
    padding-left: 4px;
    border-left: 1px solid var(--line);
    margin-left: 2px;
  }

  .dock-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 34px;
    min-width: 34px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-dim);
    transition:
      color 0.16s var(--ease),
      border-color 0.16s var(--ease),
      background 0.16s var(--ease);
  }

  .icon-btn:hover {
    color: var(--text);
    border-color: var(--line-strong);
    background: rgba(255, 255, 255, 0.06);
  }

  .icon-btn.muted {
    color: var(--warn);
    border-color: rgba(240, 195, 122, 0.3);
    background: rgba(240, 195, 122, 0.08);
  }

  .icon-btn.plain {
    border-color: transparent;
    background: transparent;
    color: var(--text-faint);
  }

  .icon-btn.plain:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
  }

  .icon-btn.danger:hover {
    color: var(--rec-bright);
    background: rgba(255, 75, 62, 0.1);
  }

  .meter {
    display: inline-flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 12px;
  }

  .meter .bar {
    width: 2px;
    height: 4px;
    border-radius: 1px;
    background: #3a3f48;
    transition: background 0.12s linear;
  }

  .meter .bar:nth-child(2) {
    height: 7px;
  }

  .meter .bar:nth-child(3) {
    height: 10px;
  }

  .meter .bar.on {
    background: var(--ok);
  }

  .stop-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 13px;
    border-radius: 8px;
    background: var(--rec);
    color: #160403;
    font-size: 12px;
    font-weight: 600;
    transition: background 0.16s var(--ease);
  }

  .stop-btn:hover {
    background: var(--rec-bright);
  }

  .stop-square {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: currentColor;
  }

  .stage-notice {
    position: absolute;
    left: 50%;
    bottom: 76px;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: min(90%, 560px);
    padding: 6px 10px;
    border: 1px solid rgba(240, 195, 122, 0.25);
    border-radius: 7px;
    background: rgba(20, 16, 9, 0.9);
    color: var(--warn);
    font-size: 10.5px;
    line-height: 1.4;
    pointer-events: none;
  }

  .countdown-layer {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(6, 7, 9, 0.74);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    text-align: center;
    padding: 24px;
  }

  .countdown-label {
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--text-faint);
  }

  .countdown-number {
    font-family: var(--mono);
    font-size: clamp(4rem, 12vw, 7rem);
    font-weight: 480;
    line-height: 0.95;
    color: #fff;
    text-shadow: 0 0 60px rgba(255, 75, 62, 0.45);
  }

  .countdown-layer .btn {
    margin-top: 18px;
  }

  .paused-layer {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: rgba(255, 255, 255, 0.4);
    background: rgba(6, 7, 9, 0.34);
    pointer-events: none;
    font-size: 10px;
    letter-spacing: 0.2em;
  }

  .saving-label {
    margin-top: 8px;
    font-size: 15px;
    font-weight: 540;
    color: var(--text);
  }

  .saving-hint {
    font-size: 11px;
    color: var(--text-faint);
  }

  .idle {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 36px 40px;
  }

  .idle-mark {
    position: relative;
    display: grid;
    place-items: center;
    width: 152px;
    height: 96px;
    margin-bottom: 26px;
    border: 1px dashed rgba(255, 255, 255, 0.14);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.012);
  }

  .corner {
    position: absolute;
    width: 11px;
    height: 11px;
    border: 0 solid rgba(255, 75, 62, 0.55);
  }

  .corner.tl {
    top: -1px;
    left: -1px;
    border-top-width: 1px;
    border-left-width: 1px;
    border-top-left-radius: 3px;
  }

  .corner.tr {
    top: -1px;
    right: -1px;
    border-top-width: 1px;
    border-right-width: 1px;
    border-top-right-radius: 3px;
  }

  .corner.bl {
    bottom: -1px;
    left: -1px;
    border-bottom-width: 1px;
    border-left-width: 1px;
    border-bottom-left-radius: 3px;
  }

  .corner.br {
    bottom: -1px;
    right: -1px;
    border-bottom-width: 1px;
    border-right-width: 1px;
    border-bottom-right-radius: 3px;
  }

  .idle-rec {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border: 1px solid rgba(255, 75, 62, 0.5);
    border-radius: 50%;
    background: rgba(255, 75, 62, 0.07);
  }

  .idle-rec span {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--rec);
    box-shadow: 0 0 18px rgba(255, 75, 62, 0.65);
    animation: breathe 3.2s ease-in-out infinite;
  }

  .idle-label {
    font-size: 8.5px;
    letter-spacing: 0.2em;
    color: var(--text-faint);
    margin-bottom: 10px;
  }

  .idle h2 {
    font-size: clamp(20px, 2.4vw, 25px);
    font-weight: 550;
    letter-spacing: -0.03em;
  }

  .idle-copy {
    margin-top: 10px;
    max-width: 44ch;
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--text-dim);
  }

  .idle-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 22px;
  }

  .idle-hint {
    margin-top: 16px;
    font-size: 9.5px;
    letter-spacing: 0.06em;
    color: #585d66;
  }

  .kbd-hint {
    font-size: 9.5px;
    color: var(--text-faint);
  }

  kbd {
    display: inline-block;
    min-width: 18px;
    padding: 2px 4px;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: #0e1115;
    font-family: var(--mono);
    font-size: 8.5px;
    text-align: center;
    color: var(--text-dim);
  }

  .state-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    margin-bottom: 18px;
    border-radius: 12px;
  }

  .state-icon.error {
    color: var(--rec-bright);
    border: 1px solid rgba(255, 75, 62, 0.3);
    background: rgba(255, 75, 62, 0.08);
  }

  .state-icon.warn {
    color: var(--warn);
    border: 1px solid rgba(240, 195, 122, 0.25);
    background: rgba(240, 195, 122, 0.07);
  }

  .spinner {
    width: 28px;
    height: 28px;
    margin-bottom: 18px;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: var(--rec);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }

  .spinner.large {
    width: 34px;
    height: 34px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel-2);
    color: var(--text);
    font-size: 12.5px;
    font-weight: 550;
    letter-spacing: -0.005em;
    transition:
      background 0.16s var(--ease),
      border-color 0.16s var(--ease),
      transform 0.16s var(--ease);
  }

  .btn:hover:not(:disabled) {
    border-color: var(--line-strong);
    background: var(--panel-3);
  }

  .btn:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn.primary {
    border-color: transparent;
    background: var(--rec);
    color: #170403;
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--rec-bright);
  }

  .btn.ghost {
    background: rgba(255, 255, 255, 0.02);
  }

  .btn.small {
    height: 32px;
    padding: 0 12px;
    font-size: 11px;
  }

  .btn.icon-only {
    width: 38px;
    padding: 0;
  }

  .btn:disabled {
    opacity: 0.42;
  }

  .btn-dot {
    position: relative;
    width: 11px;
    height: 11px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
  }

  .btn-dot::after {
    content: '';
    position: absolute;
    inset: 2.4px;
    border-radius: 50%;
    background: currentColor;
  }

  .take-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 11px 16px;
    border-top: 1px solid var(--line-soft);
    background: #0a0c10;
  }

  .take-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .take-name {
    font-size: 11px;
    color: var(--text);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .take-meta {
    font-size: 9px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta-sep {
    margin: 0 2px;
    color: #3a3f48;
  }

  .take-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .settings {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--line-soft);
    background: #0d0f13;
  }

  .settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 10px;
  }

  .reset-btn {
    font-size: 10px;
    color: var(--text-faint);
    transition: color 0.16s var(--ease);
  }

  .reset-btn:hover:not(:disabled) {
    color: var(--text);
  }

  .reset-btn:disabled {
    opacity: 0.4;
  }

  .fields {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .settings-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 18px 14px;
    scrollbar-width: thin;
    scrollbar-color: #2c313a transparent;
  }

  .settings-scroll::-webkit-scrollbar {
    width: 8px;
  }

  .settings-scroll::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 8px;
    background: #2c313a;
    background-clip: content-box;
  }

  .group + .group {
    margin-top: 15px;
    padding-top: 13px;
    border-top: 1px solid var(--line-soft);
  }

  .group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 9px;
  }

  .group-label {
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .group-hint {
    font-size: 9.5px;
    color: #565b64;
    white-space: nowrap;
  }

  .source-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .source {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 48px;
    padding: 0 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #0a0c0f;
    color: var(--text-dim);
    font-size: 10px;
    transition:
      border-color 0.16s var(--ease),
      color 0.16s var(--ease),
      background 0.16s var(--ease);
  }

  .source:hover:not(:disabled) {
    border-color: var(--line-strong);
    color: var(--text);
  }

  .source.selected {
    border-color: var(--rec-line);
    background: var(--rec-soft);
    color: #fff;
  }

  .source:disabled {
    opacity: 0.5;
  }

  .micro {
    margin-top: 7px;
    font-size: 9.5px;
    line-height: 1.5;
    color: #5f646d;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 0;
  }

  .row-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .row-label {
    font-size: 11.5px;
    color: var(--text);
    letter-spacing: -0.005em;
  }

  .row-hint {
    font-size: 9.5px;
    color: #5f646d;
  }

  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #0a0c0f;
    flex: none;
  }

  .seg button {
    height: 25px;
    padding: 0 9px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 10.5px;
    transition:
      background 0.16s var(--ease),
      color 0.16s var(--ease);
  }

  .seg button:hover:not(:disabled) {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
  }

  .seg button.on {
    background: #262b33;
    color: #fff;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .seg button:disabled {
    opacity: 0.32;
  }

  .seg.mini button {
    height: 24px;
    padding: 0 7px;
    font-size: 10px;
  }

  .seg.block {
    display: flex;
    width: 100%;
    margin-top: 5px;
  }

  .seg.block button {
    flex: 1;
    padding: 0 4px;
  }

  .size-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .size {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1px;
    height: 47px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #0a0c0f;
    text-align: left;
    transition:
      border-color 0.16s var(--ease),
      background 0.16s var(--ease);
  }

  .size:hover:not(:disabled) {
    border-color: var(--line-strong);
  }

  .size-label {
    font-size: 11px;
    color: var(--text-dim);
  }

  .size-detail {
    font-size: 8.5px;
    letter-spacing: -0.03em;
    color: #565b64;
  }

  .size.selected {
    border-color: var(--rec-line);
    background: var(--rec-soft);
  }

  .size.selected .size-label {
    color: #fff;
  }

  .size.selected .size-detail {
    color: #b97a75;
  }

  .size:disabled {
    opacity: 0.5;
  }

  .custom-size {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .custom-size label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    font-size: 8px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .custom-size input {
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: #0a0c0f;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
  }

  .custom-size input:disabled {
    opacity: 0.5;
  }

  .times {
    padding-bottom: 8px;
    font-size: 11px;
    color: var(--text-faint);
  }

  .stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .dual {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    margin-top: 9px;
  }

  .dual .row-label {
    font-size: 10.5px;
  }

  .dual .seg.block {
    margin-top: 4px;
  }

  .save-line {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 7px;
  }

  .save-label {
    flex: none;
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .file-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0a0c0f;
    color: var(--text-dim);
    font-size: 8.5px;
    transition:
      border-color 0.16s var(--ease),
      color 0.16s var(--ease);
  }

  .file-pill:hover:not(:disabled) {
    border-color: var(--line-strong);
    color: var(--text);
  }

  .file-pill:disabled {
    opacity: 0.5;
  }

  .file-pill span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .error-line {
    margin: 0 0 6px;
    font-size: 10px;
    line-height: 1.5;
    color: var(--rec-bright);
  }

  .panel-footer {
    padding: 10px 18px 14px;
    border-top: 1px solid var(--line-soft);
    background: #0b0d11;
  }

  .estimate {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 10.5px;
    color: var(--text-dim);
  }

  .estimate .sep {
    color: #3a3f48;
  }

  .estimate-sub {
    margin: 2px 0 9px;
    font-size: 9px;
    color: #565b64;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .start-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 44px;
    padding: 0 14px;
    border-radius: 10px;
    background: var(--rec);
    color: #170403;
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    box-shadow: 0 8px 26px rgba(255, 75, 62, 0.18);
    transition:
      background 0.16s var(--ease),
      opacity 0.16s var(--ease);
  }

  .start-btn:hover:not(:disabled) {
    background: var(--rec-bright);
  }

  .start-btn:disabled {
    opacity: 0.4;
    box-shadow: none;
  }

  .start-dot {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
  }

  .start-dot::after {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .start-kbd {
    margin-left: auto;
    padding: 2px 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.18);
    font-size: 8.5px;
    opacity: 0.7;
  }

  .live-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #0a0c0f;
    font-size: 11px;
    color: var(--text-dim);
  }

  .live-strip > span:last-child {
    margin-left: auto;
    color: var(--text);
  }

  .takes {
    margin-top: 22px;
  }

  .takes-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 9px;
  }

  .takes-head h2 {
    font-size: 13px;
    font-weight: 560;
    letter-spacing: -0.01em;
  }

  .takes-head span {
    font-size: 8.5px;
    letter-spacing: 0.1em;
    color: var(--text-faint);
  }

  .take-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--line-soft);
    border-radius: 12px;
    overflow: hidden;
    background: #0b0d11;
  }

  .take-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px;
  }

  .take-item + .take-item {
    border-top: 1px solid var(--line-soft);
  }

  .take-item.current {
    background: rgba(255, 75, 62, 0.045);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 72px;
    height: 40px;
    flex: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #14171d;
    color: var(--text-faint);
    overflow: hidden;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .take-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .take-file {
    font-size: 10.5px;
    color: var(--text);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .take-sub {
    font-size: 8.5px;
    color: var(--text-faint);
  }

  .take-item-actions {
    display: flex;
    gap: 2px;
    flex: none;
  }

  .shortcuts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 15px;
    padding: 14px 2px 0;
    font-size: 9.5px;
    color: var(--text-faint);
  }

  .shortcuts .label {
    font-size: 8.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #565b64;
    margin-right: 2px;
  }

  .shortcuts kbd {
    margin-right: 3px;
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(0.82);
      opacity: 0.7;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 1080px) {
    .studio-body {
      grid-template-columns: minmax(0, 1fr) 348px;
    }
  }

  @media (max-width: 900px) {
    .studio-body {
      grid-template-columns: 1fr;
      height: auto;
    }

    .stage-view {
      flex: none;
      min-height: 420px;
    }

    .settings {
      border-left: 0;
      border-top: 1px solid var(--line-soft);
    }

    .fields {
      display: block;
    }

    .settings-scroll {
      overflow: visible;
      padding-bottom: 18px;
    }

    .panel-footer {
      position: sticky;
      bottom: 0;
      z-index: 3;
     box-shadow: 0 -16px 30px rgba(5, 6, 8, 0.75);
    }

    .idle {
      padding: 30px 24px;
    }
  }

  @media (max-width: 620px) {
    .studio-chrome {
      padding: 0 12px;
    }

    .stage-view {
      min-height: 340px;
    }

    .size-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .idle-mark {
      width: 124px;
      height: 80px;
      margin-bottom: 20px;
    }

    .idle-copy {
      font-size: 12px;
    }

    .take-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 9px;
    }

    .take-actions {
      justify-content: flex-end;
    }

    .dock {
      left: 10px;
      right: 10px;
      bottom: 10px;
      padding: 7px 8px 7px 11px;
    }

    .timer {
      font-size: 15px;
    }

    .dock-sink {
      display: none;
    }

    .hud {
      top: 10px;
      left: 10px;
    }

    .hud-chip:nth-child(n + 4) {
      display: none;
    }

    .take-badge {
      top: 10px;
      left: 10px;
    }

    .shortcuts {
      display: none;
    }

    .idle-actions {
      gap: 8px;
    }
  }
</style>
