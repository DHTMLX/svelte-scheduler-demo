<script>
    import { onMount } from "svelte";
    
    import { Scheduler } from "@dhx/trial-scheduler";
    import "@dhx/trial-scheduler/codebase/dhtmlxscheduler_material.css"
    export let data;

    let scheduler;
    let container;
    onMount(() => {
        scheduler = Scheduler.getSchedulerInstance();
        scheduler.init(container, new Date(2023, 9, 6), "week");
        scheduler.events.on("ActionName", () => {})
        return () => scheduler.destructor();
    });

    $: scheduler?.parse(data);
</script>

<div bind:this={container} style="width: 100%; height: 100vh;"></div>

