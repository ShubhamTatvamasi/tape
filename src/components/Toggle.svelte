<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    disabled?: boolean;
    onchange: (next: boolean) => void;
  }

  const { checked, label, disabled = false, onchange }: Props = $props();
</script>

<button
  type="button"
  class="toggle"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onchange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    position: relative;
    width: 34px;
    height: 20px;
    flex: none;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: #0b0d10;
    transition:
      background 0.2s var(--ease),
      border-color 0.2s var(--ease);
  }

  .toggle::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 0;
    background: radial-gradient(circle at 30% 50%, rgba(255, 75, 62, 0.35), transparent 70%);
    transition: opacity 0.2s var(--ease);
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #787d86;
    transition:
      transform 0.2s var(--ease),
      background 0.2s var(--ease);
  }

  .on {
    border-color: var(--rec-line);
    background: rgba(255, 75, 62, 0.16);
  }

  .on::after {
    opacity: 1;
  }

  .on .knob {
    transform: translateX(14px);
    background: #fff;
    box-shadow: 0 0 10px rgba(255, 75, 62, 0.55);
  }

  .toggle:disabled {
    opacity: 0.75;
    cursor: not-allowed;
  }
</style>
