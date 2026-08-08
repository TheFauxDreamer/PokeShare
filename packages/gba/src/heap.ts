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
 * STATUS: this is currently the *secondary* path. Inspecting the shipped build
 * showed `updateMemoryViews()` assigning only to module-scope variables, with
 * zero occurrences of `Module["HEAPU8"]` -- so the `extends EmscriptenModule`
 * declaration is optimistic and the heap really is unreachable through the
 * public API. The core is also threaded (`wasmMemory` arrives via `msgData`
 * from a pthread worker), so memory is *imported* into the module rather than
 * exported from it, and overriding `instantiateWasm` risks disturbing the
 * worker bootstrap. savestate.ts is used instead: fully supported, verified
 * offsets, and cheap enough at 4 Hz.
 *
 * Keep this for the day it is worth eliminating the per-poll serialise cost.
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
        // A threaded build imports a shared memory rather than exporting one,
        // so the import is the expected case here, not the fallback.
        const imported = imports["env"]?.["memory"];
        const exported = output.instance.exports["memory"];
        if (imported instanceof WebAssembly.Memory) memory = imported;
        else if (exported instanceof WebAssembly.Memory) memory = exported;
        successCallback(output.instance, output.module);
      });
      return {};
    },

    heap: () => (memory ? new Uint8Array(memory.buffer) : undefined),
  };
}
