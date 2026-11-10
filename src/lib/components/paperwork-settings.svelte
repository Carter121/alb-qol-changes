<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { paperwork } from "../../tweaks/pinc/paperwork-state.svelte";
  import { API_URL } from "../../tweaks/pinc/paperwork-api";

  let code = $state("");
  let label = $state("");
  let busy = $state(false);
  let error = $state("");
  const messages = {
    off: "Paperwork sync is off.",
    setup: "Set up paperwork sync",
    connecting: "Loading paperwork status...",
    connected: "Paperwork sync connected",
    saving: "Saving paperwork status...",
    disconnected: "Disconnected. Status is unknown.",
    unauthorized: "Device access rejected. Enroll again.",
  };
  async function enroll(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const secret = code;
    code = "";
    try {
      await paperwork.enroll(secret, label);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Enrollment failed.";
    } finally {
      busy = false;
    }
  }
</script>

<Sidebar.Group>
  <Sidebar.GroupLabel>Paperwork sync</Sidebar.GroupLabel>
  <Sidebar.GroupContent class="flex flex-col gap-3 px-2">
    <p role="status" class="text-sm">{messages[paperwork.phase]}</p>
    <p class="text-muted-foreground text-xs">
      Tracks if paperwork is at the guard shack or not.
    </p>
    <!-- <p class="text-muted-foreground break-all text-xs">Server: {API_URL}</p> -->
    {#if paperwork.notice}<p role="status" class="text-sm">
        {paperwork.notice}
      </p>{/if}
    {#if paperwork.phase !== "off"}
      {#if !paperwork.configured}
        <form onsubmit={enroll} class="flex flex-col gap-3">
          <fieldset disabled={busy} class="flex min-w-0 flex-col gap-2">
            <legend class="sr-only">Enroll this workstation</legend>
            <Label for="paperwork-code">Enrollment code</Label>
            <Input
              id="paperwork-code"
              type="password"
              bind:value={code}
              autocomplete="off"
              required
            />
            <Label for="paperwork-label">Device label (optional)</Label>
            <Input
              id="paperwork-label"
              bind:value={label}
              maxlength={80}
              placeholder="Guard PC A"
            />
            <Button type="submit" size="sm" disabled={busy}
              >{busy ? "Enrolling..." : "Connect device"}</Button
            >
          </fieldset>
        </form>
      {:else}
        <Label for="paperwork-transport">Connection method</Label>
        <select
          id="paperwork-transport"
          class="bg-background text-foreground rounded-md border p-2 text-sm"
          value={paperwork.transport}
          onchange={(event) =>
            paperwork.setTransport(
              event.currentTarget.value === "sse" ? "sse" : "poll",
            )}
          disabled={paperwork.phase === "saving"}
        >
          <option value="sse">SSE (faster)</option>
          <option value="poll">Polling (2.5 seconds)</option>
        </select>
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            paperwork.notice = "";
            paperwork.restart();
          }}
          disabled={paperwork.phase === "saving"}>Retry connection</Button
        >
        <Button
          variant="outline"
          size="sm"
          disabled
          onclick={() => {
            code = "";
            error = "";
            paperwork.forget();
          }}>Forget device</Button
        >
      {/if}
    {/if}
    {#if error}<p role="alert" class="text-sm">{error}</p>{/if}
  </Sidebar.GroupContent>
</Sidebar.Group>
