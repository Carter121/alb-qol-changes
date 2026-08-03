<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar";
  import SidebarTab from "$lib/components/sidebar-tab.svelte";
  import TweaksGroup from "$lib/components/tweaks-group.svelte";
  import type { TweakManager } from "./tweaks/manager.svelte";

  let { manager }: { manager: TweakManager } = $props();
</script>

<Sidebar.Provider
  open={false}
  class="min-h-0 w-0"
  style="--sidebar-width: 256px; --sidebar-width-icon: 48px;"
>
  <!-- dark scoped to the panel only; text color re-declared inside the scope -->
  <Sidebar.Root side="left" class="dark text-sidebar-foreground shadow-2xl">
    <Sidebar.Header>
      <span class="text-sm font-semibold">ALB QOL</span>
    </Sidebar.Header>
    <Sidebar.Separator />
    <Sidebar.Content>
      <Sidebar.Group>
        <Sidebar.GroupLabel>Tweaks</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <TweaksGroup {manager} />
        </Sidebar.GroupContent>
      </Sidebar.Group>
      <Sidebar.Group>
        <Sidebar.GroupLabel>Check-Ins</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <p class="text-muted-foreground px-2 text-xs">Recent PINC check-ins will live here.</p>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    </Sidebar.Content>
    <SidebarTab />
  </Sidebar.Root>
</Sidebar.Provider>
