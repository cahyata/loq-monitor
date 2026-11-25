# Performance

Measurements and decisions for CPU use. Numbers are percent of one core on the test machine (Lenovo LOQ 83JC, 16 threads), measured over 20 s, dev build, overlay visible.

## Current state

| Part | CPU |
|---|---|
| App window and its WebView2 processes, any tab, visual effects on | 4 to 9 % |
| Overlay page | under 0.5 % |
| SensorService on the Overview | about 4.5 % |
| SensorService with the Insights tab open | about 8 % (program scan 2.2 points, the rest of the tick 3.5) |
| SensorService | 4 to 5 % |

## Method

- **App:** CPU time of `app.exe` plus its WebView2 child processes, sampled twice 20 s apart. Page profile and layout counts come from the DevTools protocol (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, development only).
- **Service:** CPU time of `SensorService.exe`, three samples of 20 s per build, builds alternated. Time per section comes from temporary timing code that is not kept in the repository.

## Log of changes

| Idea | Before, after | Verdict | Why |
|---|---|---|---|
| Animate the meter and per-thread bars with `transform` instead of `width` and `height` | Overview 40 to 44 %, then 26 to 31 % | kept | Layout runs fell from 736 to 30 in 10 s. |
| Remove the 0.4 s transitions on those bars | 26 to 31 %, then 3.7 to 8.3 % | kept | The data changes once a second. Animating 19 bars for 40 % of every second kept the GPU process busy. |
| Read each Lenovo value once per tick, reuse the call parameters, refresh power mode and ACPI zones every 3 s and battery power every 2 s | One tick 260 ms, then 159 ms; WMI calls per second 11, then about 5 | kept | The WMI calls mostly wait on the embedded controller, so CPU did not move (4.2 to 4.8 %, then 3.9 to 7.7 %, inside the noise). The tick is shorter and the controller is polled less. |
| Skip layout work on the overlay page | 0.03 s of main thread in 10 s | not done | Nothing to gain. |
| Stop the blink on a hot temperature chip | 3 % | not done | The blink is the alert. |
| Refresh drives every 3 to 5 s | about 0.9 % | not done | Slower disk readings for a small gain. |
| Update the GPU less often | | not done | About 12 ms of CPU per tick, and temperatures need one second. |
| Replace the CSS blink of a hot temperature chip with a class that flips twice a second | Overview 14 to 16 %, then 6.4 % | kept | Any running CSS animation makes the browser produce frames at 60 Hz even when nothing changes. One chip cost about 6 points. |
| Replace the 60 Hz CSS animation of the moving grid with a timer that steps it ten times a second, and stop it on battery | Visual effects on: about 50 %, then 4 to 9 % | kept | The default setting had the window using half a core while it had focus. The grid also stops with no focus, hidden, effects off or reduced motion. |
| `will-change: opacity` on the blinking chip | 15.8 and 14.0 %, against 15.1 % | not done | Inside the noise. |
| Hide the scanline overlay | about 2.5 points | not done | It is part of the look, and the cost is small once the grid is stepped. |
| Ask only for GPU engines with a nonzero running total in the program scan | Insights service CPU 8.9 to 13.6 % (average 10.7), then 6.6 to 8.8 % (average 7.8), in two alternating pairs | kept | The query returned 717 rows and 6 times the work for 91 useful rows. |
| Scan programs every 4 s instead of 3 s | about 0.5 points | not done | Not measurable against the noise, and the list gets staler. |
| Time of the Insights page itself | 0.19 s of main thread in 10 s | not done | Nothing to gain. |
