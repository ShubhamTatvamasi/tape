<script lang="ts">
  interface Props {
    name: string;
    size?: number;
    strokeWidth?: number;
  }

  const { name, size = 16, strokeWidth = 1.6 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'screen'}
    <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
    <path d="M8 20.5h8M12 16.5v4" />
  {:else if name === 'window'}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M6.6 6.6h.01M9.6 6.6h.01" />
  {:else if name === 'tab'}
    <path d="M8 3h11a2 2 0 0 1 2 2v11" />
    <rect x="3" y="8" width="13" height="13" rx="2" />
  {:else if name === 'any'}
    <circle cx="12" cy="12" r="9" />
    <path d="M9.4 9.2a2.7 2.7 0 1 1 4.2 2.3c-.9.6-1.6 1.2-1.6 2.5" />
    <path d="M12 17h.01" />
  {:else if name === 'mic'}
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
  {:else if name === 'mic-off'}
    <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.8-1" />
    <path d="M5 11a7 7 0 0 0 10.8 6M19 11v.5M12 18v3M8 21h8" />
    <path d="m3 3 18 18" />
  {:else if name === 'speaker'}
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 6a8 8 0 0 1 0 12" />
  {:else if name === 'pause'}
    <rect x="7" y="5" width="3.4" height="14" rx="1" />
    <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
  {:else if name === 'play'}
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  {:else if name === 'stop'}
    <rect x="6" y="6" width="12" height="12" rx="2" />
  {:else if name === 'record'}
    <circle cx="12" cy="12" r="6" />
  {:else if name === 'download'}
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  {:else if name === 'share'}
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  {:else if name === 'trash'}
    <path d="M4 7h16M9 7V4h6v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6" />
  {:else if name === 'disk'}
    <path d="M7 13V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v7" />
    <rect x="3" y="13" width="18" height="8" rx="2" />
    <path d="M7 17h.01M11 17h.01" />
  {:else if name === 'cursor'}
    <path d="m4 3 7.4 18 2.7-7.4L21.5 11 4 3Z" />
  {:else if name === 'check'}
    <path d="m5 12 4.5 4.5L19 7" />
  {:else if name === 'alert'}
    <path d="M12 3 2.5 20h19L12 3Z" />
    <path d="M12 9v5M12 17.2h.01" />
  {:else if name === 'film'}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  {:else if name === 'close'}
    <path d="m6 6 12 12M18 6 6 18" />
  {:else if name === 'arrow'}
    <path d="M5 12h14M13 6l6 6-6 6" />
  {:else if name === 'github'}
    <path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.6-.2.6-.5v-1.8c-2.6.6-3.1-1.1-3.1-1.1-.4-1.1-1-1.4-1-1.4-.8-.6.1-.6.1-.6.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.6.8.1-.6.3-1 .6-1.3-2.1-.2-4.2-1-4.2-4.6 0-1 .4-1.9 1-2.5-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.6.6.6 1 1.5 1 2.5 0 3.6-2.1 4.4-4.2 4.6.3.3.6.9.6 1.8v2.6c0 .3.2.6.6.5A9.2 9.2 0 0 0 12 2.8Z" />
  {/if}
</svg>
