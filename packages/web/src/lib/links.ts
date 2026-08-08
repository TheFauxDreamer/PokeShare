/**
 * URLs for the other views of a run.
 *
 * Pure and origin-parameterised so they can be tested, and so an OBS browser
 * source on another machine can be pointed at the right host.
 */

function currentOrigin(): string {
  return globalThis.location?.origin ?? "";
}

export function playUrl(code: string, origin = currentOrigin()): string {
  return `${origin}/play?run=${encodeURIComponent(code)}`;
}

export function streamUrl(code: string, origin = currentOrigin()): string {
  return `${origin}/stream?run=${encodeURIComponent(code)}`;
}

export function pairsUrl(code: string, origin = currentOrigin()): string {
  return `${origin}/pairs?run=${encodeURIComponent(code)}`;
}

/**
 * Copy text, falling back when the async Clipboard API is unavailable.
 *
 * `navigator.clipboard` needs a secure context; localhost qualifies, but the
 * fallback keeps this working over plain HTTP on a LAN, and in Safari when
 * permission is refused.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than failing outright.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Keep it off-screen but still selectable.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Join codes are read aloud over voice chat, so accept them loosely: any case,
 * with spaces or dashes, and normalise here rather than making the user match
 * an exact format.
 */
export function normaliseJoinCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Put the code in the address bar once it is known.
 *
 * Means a refresh keeps the run, and the URL can be copied straight into an OBS
 * browser source. `replaceState` rather than `pushState` so Back does not step
 * through every attempt.
 */
export function rememberRunInUrl(code: string): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("run", code);
  globalThis.history.replaceState(null, "", url);
}
