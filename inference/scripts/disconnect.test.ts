import { readFile, watch, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { expect, test } from "vitest"

const origin = process.env.MAGNITUDE_DISCONNECT_ORIGIN
const logPath = process.env.MAGNITUDE_ICN_LOG
const evidence: unknown[] = []

// This integration test observes real HTTP disconnects and the worker's physical execution clock.
test.runIf(Boolean(origin && logPath)).each([true, false])(
  "releases a real generation after a client disconnect, stream=%s",
  async (stream) => {
    const offset = (await readFile(logPath!, "utf8")).length
    const watcher = watch(logPath!, { signal: AbortSignal.timeout(60_000) })[Symbol.asyncIterator]()
    const rows = async () => (await readFile(logPath!, "utf8")).slice(offset)
      .replace(/\x1b\[[0-9;]*m/g, "").split("\n")
    const waitFor = async (predicate: (lines: string[]) => boolean) => {
      for (;;) {
        const lines = await rows()
        if (predicate(lines)) return lines
        await watcher.next()
      }
    }
    const body = JSON.stringify({
      model: "swift-1.5-qwen3.8-27b:gguf:q6", stream,
      messages: [{ role: "user", content: "List every integer from 1 to 10000, one per line. Do not stop early." }],
      max_tokens: 8192, reasoning_effort: "none", ignore_eos: true,
    })
    let receivedBytes = 0
    let status: number | undefined
    let clientError: Error | undefined
    const client = request(new URL("/inference/v1/chat/completions", origin!), {
      method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    }, response => {
      status = response.statusCode
      response.on("data", chunk => { receivedBytes += chunk.length })
    })
    client.on("error", error => { clientError = error })
    try {
      client.end(body)
      await waitFor(lines => lines.filter(line => line.includes("generation output")).length >= 6)
      const disconnectedAt = Date.now()
      if (stream) {
        expect(status).toBe(200)
        expect(receivedBytes).toBeGreaterThan(0)
        client.destroy()
      } else {
        expect(receivedBytes).toBe(0)
        // A silent non-streaming response must honor a real client's socket timeout.
        client.setTimeout(1, () => client.destroy())
      }
      const lines = await waitFor(lines => lines.some(line => line.includes("generation slot released")))
      const output = lines.filter(line => line.includes("generation output"))
      const cancel = lines.find(line => line.includes("generation cancel received"))!
      const released = lines.find(line => line.includes("generation slot released"))!
      const timestamp = (line: string) => Date.parse([...line.matchAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/g)].at(-1)![0])
      const tokenIntervals = output.slice(1).map((line, index) =>
        (timestamp(line) - timestamp(output[index]!)) / Number(line.match(/output.tokens=(\d+)/)![1]))
      const tokenTimeMs = tokenIntervals.sort((a, b) => a - b)[Math.floor(tokenIntervals.length / 2)]!
      expect(cancel).toBeDefined()
      expect(released).toContain("Cancelled")
      expect(output.filter(line => timestamp(line) > timestamp(cancel))).toHaveLength(0)
      const releaseMs = timestamp(released) - disconnectedAt
      expect(releaseMs).toBeLessThanOrEqual(tokenTimeMs * 2 + 25)
      if (clientError !== undefined) expect(clientError.message).toContain("socket hang up")
      const result = { stream, receivedBytes, tokenTimeMs, releaseMs, cancel, released, outputBatches: output.length }
      evidence.push(result)
      console.log(JSON.stringify(result))
      if (process.env.MAGNITUDE_DISCONNECT_EVIDENCE) {
        await writeFile(process.env.MAGNITUDE_DISCONNECT_EVIDENCE, JSON.stringify(evidence))
      }
    } finally {
      client.destroy()
      await watcher.return?.()
    }
  },
  60_000,
)
