# Run the private Swift build locally

Working directory: `/Users/jacobfreed/Developer/magnitude-fork`.
These commands use private version `0.2.6-local.swift.disconnect.20261011.1` on branch `swift-gguf`.
They do not install over `/Applications/Magnitude.app` or use `~/.magnitude`.
The CLI and ACN were rebuilt with the repository's `deriveLocalRelease` helper.
The loopback origin supplies the matching release manifest and inference artifact through the normal release resolver.
`MAGNITUDE_ICN_PATH` stays empty; no inference-path override is used.

## Start the release origin

In terminal 1, run this exact command from the working directory and leave it running:

```sh
bun -e 'const root="bin/private-release-0.2.6-local.swift.disconnect.20261011.1"; const base="release-candidate"; const manifest=await Bun.file(root+"/magnitude-release.json").json(); const files=new Map([["magnitude-release.json",root+"/magnitude-release.json"],...manifest.artifacts.map(a=>[a.filename,(["cli","acn","icn-base"].includes(a.kind)?root:base)+"/"+a.filename])]); const server=Bun.serve({hostname:"127.0.0.1",port:62361,fetch(request){const path=files.get(new URL(request.url).pathname.split("/").pop()); return path?new Response(Bun.file(path)):new Response("Not found",{status:404});}}); console.log("Private release origin ready at "+server.url);'
```

## Start serve

In terminal 2, run this exact command from the working directory and leave it running:

```sh
env MAGNITUDE_DEV_DATA_DIR=$PWD/bin/rt MAGNITUDE_DEV_PORT=10100 MAGNITUDE_RELEASE_BASE_URL=http://127.0.0.1:62361 MAGNITUDE_ICN_PATH= MAGNITUDE_ICN_LOG=$PWD/bin/rt/logs/inference.log MAGNITUDE_ICN_WORKER_RUST_LOG=magnitude_engine=info,magnitude_scheduler=info RUST_LOG=magnitude_service_server=info bin/private-app-0.2.6-local.swift.disconnect.20261011.1/Magnitude.app/Contents/Resources/magnitude serve
```

Wait for `Magnitude is serving at http://127.0.0.1:10100`.

## Pull and load Swift

In terminal 3, inspect the processes before loading. Only this private serve and its own inference service may be running.
The origin also matches this search because its command contains Magnitude artifact names.
Do not load if another model server is present.

```sh
pgrep -fl 'splash|magnitude|llama'
sysctl kern.memorystatus_level hw.memsize
vm_stat
```

Available host memory is `floor(hw.memsize * kern.memorystatus_level / 100)`.
The ordinary managed pull resolves the pinned target, projector, and DFlash2 draft.
This run downloaded Q6_K through that path; no model files were copied or linked by hand.
The files remain installed in the private data directory, so the pull is optional for this existing installation.

```sh
env MAGNITUDE_DEV_DATA_DIR=$PWD/bin/rt MAGNITUDE_DEV_PORT=10100 bin/private-app-0.2.6-local.swift.disconnect.20261011.1/Magnitude.app/Contents/Resources/magnitude catalog pull swift-1.5-qwen3.8-27b:gguf:q6
env MAGNITUDE_DEV_DATA_DIR=$PWD/bin/rt MAGNITUDE_DEV_PORT=10100 bin/private-app-0.2.6-local.swift.disconnect.20261011.1/Magnitude.app/Contents/Resources/magnitude models load swift-1.5-qwen3.8-27b:gguf:q6
env MAGNITUDE_DEV_DATA_DIR=$PWD/bin/rt MAGNITUDE_DEV_PORT=10100 bin/private-app-0.2.6-local.swift.disconnect.20261011.1/Magnitude.app/Contents/Resources/magnitude models status swift-1.5-qwen3.8-27b:gguf:q6
env MAGNITUDE_DEV_DATA_DIR=$PWD/bin/rt MAGNITUDE_DEV_PORT=10100 bin/private-app-0.2.6-local.swift.disconnect.20261011.1/Magnitude.app/Contents/Resources/magnitude catalog show swift-1.5-qwen3.8-27b:gguf:q6
```

Wait for `Runtime Ready`. The catalog detail should show `Acceleration DFlash2`.
Swift uses the same `z-lab/Qwen3.8-27B-DFlash2-GGUF/Qwen3.8-27B-DFlash2-Q8_0.gguf` draft as the base Q6 entry.

## Send one coding request

Loopback requests need no API key, as documented in `cli/src/agent-docs/topics/remote-access.md`.
The historical receipt below belongs to private version `0.2.6-local.swift.160843e4`.

```sh
curl --fail-with-body --max-time 180 -H 'Content-Type: application/json' http://127.0.0.1:10100/inference/v1/chat/completions -d '{"model":"swift-1.5-qwen3.8-27b:gguf:q6","messages":[{"role":"user","content":"Write a Python function add(a, b) that returns their sum. Reply with code only."}],"max_tokens":128,"reasoning_effort":"none"}'
```

Observed HTTP status: 200.
Reply:

```python
def add(a, b):
    return a + b
```

Usage: {"prompt_tokens":31,"completion_tokens":18,"total_tokens":49,"prompt_tokens_details":{"cached_tokens":0}}.
The loaded worker's physical footprint after this request was 28,417,936,552 bytes; peak was 28,474,444,968 bytes.
This is one smoke sample, not a comparative benchmark.
That historical inference binary's SHA-256 was `ce03b4749db8fef8832a13824e4e10e8bc2b99ff9876ed8084c60cc7e6ce7029`.

The explicit log file retains ICN and worker diagnostics at `bin/rt/logs/inference.log`.
The worker filter enables token counts, cancellation, and slot-release records, without prompt or output text.
Without these variables, log retention remains disabled and the worker filter remains `error`.
The file uses append mode. Preserve it after each run. A failed file write does not stop inference.

## Check client disconnects

After the model reaches `Runtime Ready`, run the real-path regression:

```sh
env MAGNITUDE_DISCONNECT_ORIGIN=http://127.0.0.1:10100 MAGNITUDE_ICN_LOG=$PWD/bin/rt/logs/inference.log MAGNITUDE_DISCONNECT_EVIDENCE=$PWD/bin/disconnect-smoke.json bunx --bun vitest run --root inference scripts/disconnect.test.ts
```

The regression starts a long request, disconnects after native output, and checks cancellation and slot release.
It repeats the request without a stream and closes the client through its socket timeout.
The retained JSON records the token time and release delay for each request.
This test needs a loaded model. Ordinary suites skip it unless the origin and log variables exist.

Observed on 2026-10-11 with private version `0.2.6-local.swift.disconnect.20261011.1`:

- Streaming: six output batches, 3,836 client bytes, 36.5 ms median token time, and slot release 7 ms after disconnect.
- Non-streaming: six output batches, no response bytes, 36.25 ms median token time, and slot release 10 ms after timeout.
- Both requests finished as `Cancelled`. Neither published output after the worker received cancellation.

Receipts: `bin/disconnect-smoke.json` and `bin/rt/logs/inference.log`.
The installed inference binary's SHA-256 was `4c94f5f5f361954d59087eb34b1b7778c403dbad082e2ba36e0ea4199458b294`.

## Stop everything

In terminal 3:

```sh
env MAGNITUDE_DEV_DATA_DIR=$PWD/bin/rt MAGNITUDE_DEV_PORT=10100 bin/private-app-0.2.6-local.swift.disconnect.20261011.1/Magnitude.app/Contents/Resources/magnitude models stop
```

Then press Ctrl+C in terminal 2 to stop serve, and in terminal 1 to stop the origin.
Finally run:

```sh
pgrep -fl 'splash|magnitude|llama'
```

No output and exit status 1 mean there are no matching servers.
The recorded run ended with the model stopped, serve exiting 0, the origin exiting 1 after SIGINT, and an empty process search.
