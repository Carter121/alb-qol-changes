<script lang="ts">
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import { useSidebar } from "$lib/components/ui/sidebar";

  //* Pull tab on the drawer's edge. SVG instead of clip-path so the slanted
  //* border can be stroked, with the attached edge left open.
  const sidebar = useSidebar();
</script>

<button
  type="button"
  aria-label="Toggle sidebar"
  aria-expanded={sidebar.open}
  onclick={() => sidebar.toggle()}
  class="group/tab focus-visible:ring-ring absolute top-1/2 left-full flex h-20 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-md outline-none focus-visible:ring-2"
>
  <svg class="absolute inset-0 size-full" viewBox="0 0 24 80" aria-hidden="true">
    <path
      d="M0 0 L23.5 10 V70 L0 80 Z"
      class="fill-sidebar group-hover/tab:fill-sidebar-accent transition-colors"
    />
    <path d="M0 0 L23.5 10 V70 L0 80" fill="none" class="stroke-border" stroke-width="1" />
  </svg>
  <ChevronRightIcon
    class="text-muted-foreground relative size-4 transition-transform duration-200 group-data-[state=expanded]:rotate-180"
  />
</button>
