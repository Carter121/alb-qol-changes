<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar";
  import SidebarTab from "$lib/components/sidebar-tab.svelte";
  import TweaksGroup from "$lib/components/tweaks-group.svelte";
  import type { TweakManager } from "./tweaks/manager.svelte";

  let { manager }: { manager: TweakManager } = $props();

  const SIDEBAR_WIDTH_PX = 256;
  let open = $state(false);

  //* The sidebar is a fixed overlay, so pushing the document right by its
  //* width squeezes the site into the remaining space instead of covering it.
  //* Timing matches the sidebar's slide (duration-200 ease-linear). Desktop
  //* only; the mobile sheet keeps overlaying and never touches this state.
  $effect(() => {
    const el = document.documentElement;
    el.style.transition = "margin-left 200ms linear";
    el.style.marginLeft = open ? `${SIDEBAR_WIDTH_PX}px` : "";
    return () => {
      el.style.transition = "";
      el.style.marginLeft = "";
    };
  });
</script>

<Sidebar.Provider
  bind:open
  class="min-h-0 w-0"
  style="--sidebar-width: {SIDEBAR_WIDTH_PX}px; --sidebar-width-icon: 48px;"
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
<!--      <Sidebar.Group>-->
<!--        <Sidebar.GroupLabel>Check-Ins</Sidebar.GroupLabel>-->
<!--        <Sidebar.GroupContent>-->
<!--          <p class="text-muted-foreground px-2 text-xs">Recent PINC check-ins will live here.</p>-->
<!--        </Sidebar.GroupContent>-->
<!--      </Sidebar.Group>-->
    </Sidebar.Content>
    <SidebarTab />
  </Sidebar.Root>
</Sidebar.Provider>
