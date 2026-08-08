/**
 * Direct wasm heap access for @thenick775/mgba-wasm.
 *
 * The shipped module exposes no memory-read API: `mgba.d.ts` covers only saves,
 * save states, input and lifecycle, and the built `mgba.js` exports `FS`,
 * `cwrap` and `instantiateWasm` on Module -- but *not* `HEAPU8` or
 * `wasmMemory`. So we cannot ask the module for its heap.
 *
 * We can, however, instantiate the module ourselves. `instantiateWasm` is a
 * standard Emscripten hook that hands compilation to the host; taking it lets
 * us keep a reference to the `WebAssembly.Memory` before handing the instance
 * back. From there the whole heap -- including emulated EWRAM and IWRAM -- is a
 * plain typed array, and reads cost nothing per poll.
 *
 * This is the primary path. See savestate.ts for the fallback.
 */

export interface HeapCapture {
  /**
   * Assign to `Module.instantiateWasm` before creating the emulator.
   *
   * Returning `{}` tells Emscripten that instantiation is asynchronous and
   * that it should wait for `successCallback`.
   */
  readonly instantiateWasm: (
    imports: WebAssembly.Imports,
    successCallback: (
      instance: WebAssembly.Instance,
      module: WebAssembly.Module,
    ) => void,
  ) => Record<string, never>;

  /**
   * A view over the current heap, or `undefined` before instantiation.
   *
   * Always call this per poll rather than caching the array: the heap can grow,
   * and `memory.grow()` detaches every existing `ArrayBuffer` view.
   */
  readonly heap: () => Uint8Array | undefined;
}

/**
 * Create the hook and the heap accessor.
 *
 * @param wasmBinary the fetched contents of `mgba.wasm`
 */
export function createHeapCapture(wasmBinary: BufferSource): HeapCapture {
  let memory: WebAssembly.Memory | undefined;

  return {
    instantiateWasm: (imports, successCallback) => {
      void WebAssembly.instantiate(wasmBinary, imports).then((output) => {
        const exported = output.instance.exports["memory"];
        if (exported instanceof WebAssembly.Memory) {
          memory = exported;
        } else {
          // Emscripten can import memory instead of exporting it.
          const imported = imports["env"]?.["memory"];
          if (imported instanceof WebAssembly.Memory) memory = imported;
        }
        successCallback(output.instance, output.module);
      });
      return {};
    },

    heap: () => (memory ? new Uint8Array(memory.buffer) : undefined),
  };
}
