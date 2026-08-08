/**
 * Canvas video over WebRTC.
 *
 * The play view publishes its emulator canvas; the stream view subscribes to
 * both players. Signalling is relayed by the PokeShare server, which never
 * inspects the payloads.
 *
 * Players are in different houses, so a TURN relay is required for the NAT
 * pairs that will not hole-punch. Configure via VITE_TURN_URL / VITE_TURN_USER
 * / VITE_TURN_CREDENTIAL; without it, connections work on the same LAN and
 * often but not always across the internet.
 */

import type { ClientMessage, PlayerId } from "@pokeshare/shared";

const FRAME_RATE = 30;

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302"] },
  ];
  const turnUrl = import.meta.env["VITE_TURN_URL"];
  if (turnUrl) {
    servers.push({
      urls: [turnUrl],
      username: import.meta.env["VITE_TURN_USER"] ?? "",
      credential: import.meta.env["VITE_TURN_CREDENTIAL"] ?? "",
    });
  }
  return servers;
}

export type SignalSender = (message: ClientMessage) => void;

/**
 * Publish a canvas to whoever asks for it.
 *
 * The publisher answers offers rather than initiating, so the stream view can
 * be opened and reloaded freely without the players touching anything.
 */
export function publishCanvas(
  canvas: HTMLCanvasElement,
  send: SignalSender,
): { accept(from: PlayerId | "stream", payload: unknown): void; close(): void } {
  const stream = canvas.captureStream(FRAME_RATE);
  const peers = new Map<string, RTCPeerConnection>();

  /**
   * @param fresh discard any existing peer for this key first.
   *
   * A new offer means the far side restarted negotiation — reusing the old
   * connection would answer into a dead peer, so the stream view's retry would
   * appear to do nothing.
   */
  function peerFor(
    key: string,
    to: PlayerId | "stream",
    fresh = false,
  ): RTCPeerConnection {
    const existing = peers.get(key);
    if (existing && !fresh) return existing;
    if (existing) {
      existing.close();
      peers.delete(key);
    }

    const peer = new RTCPeerConnection({ iceServers: iceServers() });
    for (const track of stream.getTracks()) peer.addTrack(track, stream);
    peer.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        send({ type: "signal", to, payload: { candidate: event.candidate } });
      }
    });
    peers.set(key, peer);
    return peer;
  }

  return {
    accept(from, payload) {
      const message = payload as {
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      };
      // An offer starts a fresh negotiation; ICE candidates continue one.
      const peer = peerFor(String(from), from, message.sdp?.type === "offer");

      if (message.sdp?.type === "offer") {
        void peer
          .setRemoteDescription(message.sdp)
          .then(() => peer.createAnswer())
          .then((answer) => peer.setLocalDescription(answer).then(() => answer))
          .then((answer) => {
            send({ type: "signal", to: from, payload: { sdp: answer } });
          });
      } else if (message.candidate) {
        void peer.addIceCandidate(message.candidate);
      }
    },
    close() {
      for (const peer of peers.values()) peer.close();
      peers.clear();
    },
  };
}

/** Subscribe to one player's canvas. Returns the stream once tracks arrive. */
export function subscribeToPlayer(
  player: PlayerId,
  send: SignalSender,
  onStream: (stream: MediaStream) => void,
): { accept(payload: unknown): void; close(): void } {
  const peer = new RTCPeerConnection({ iceServers: iceServers() });
  peer.addTransceiver("video", { direction: "recvonly" });

  peer.addEventListener("track", (event) => {
    const [stream] = event.streams;
    if (stream) onStream(stream);
  });
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      send({ type: "signal", to: player, payload: { candidate: event.candidate } });
    }
  });

  void peer
    .createOffer()
    .then((offer) => peer.setLocalDescription(offer).then(() => offer))
    .then((offer) => {
      send({ type: "signal", to: player, payload: { sdp: offer } });
    });

  return {
    accept(payload) {
      const message = payload as {
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      };
      if (message.sdp?.type === "answer") {
        void peer.setRemoteDescription(message.sdp);
      } else if (message.candidate) {
        void peer.addIceCandidate(message.candidate);
      }
    },
    close() {
      peer.close();
    },
  };
}
