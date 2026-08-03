<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { Label } from "$lib/components/ui/label";
  import { Switch } from "$lib/components/ui/switch";
  import type { TweakManager } from "../../tweaks/manager.svelte";

  //* One-way checked keeps the manager the single writer.
  let { manager }: { manager: TweakManager } = $props();
</script>

{#if manager.tweaks.length === 0}
  <p class="text-muted-foreground px-2 text-xs">No tweaks for this site.</p>
{:else}
  <Sidebar.Menu>
    {#each manager.tweaks as tweak (tweak.id)}
      <Sidebar.MenuItem class="flex items-start justify-between gap-2 px-2 py-1.5">
        <div class="flex min-w-0 flex-col gap-1">
          <Label for="tweak-{tweak.id}">{tweak.title}</Label>
          {#if tweak.description}
            <span class="text-muted-foreground text-xs">{tweak.description}</span>
          {/if}
        </div>
        <Switch
          id="tweak-{tweak.id}"
          checked={manager.enabled[tweak.id]}
          onCheckedChange={(value) => manager.setEnabled(tweak.id, value)}
        />
      </Sidebar.MenuItem>
    {/each}
  </Sidebar.Menu>
{/if}
