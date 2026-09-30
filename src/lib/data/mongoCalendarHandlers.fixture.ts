/** Independent synthetic remote: no application builders, codecs or Mongo reads. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const CALENDAR_ID = "synthetic-calendar-1@example.invalid";
export const PRIVATE_MARKER = "synthetic-calendar-private-marker";
export type RemoteBody = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: Array<{ email: string }>;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  extendedProperties?: { private?: Record<string, string> };
};
export type RemoteEvent = RemoteBody & { status: string; etag: string; updated: string };
export type RemoteCall = {
  kind: "oauth" | "acl" | "event" | "slack";
  method: string;
  url: string;
  body: unknown;
  calendarId?: string;
  eventId?: string;
  sendUpdates: string | null;
  ifMatch: string | null;
  status?: number;
};

/** Frozen contract calculation, deliberately not imported from calendarWriteClient. */
export function expectedEventId(operationId: string, eventDate: string, previousEventId = "", calendarId = CALENDAR_ID): string {
  const seed = JSON.stringify(["hub-om-calendar-v1", calendarId, operationId, eventDate, previousEventId]);
  return createHash("sha256").update(JSON.stringify([seed, 0])).digest("hex");
}

export class SyntheticCalendarRemote {
  readonly events = new Map<string, Map<string, RemoteEvent>>();
  readonly ledger: RemoteCall[] = [];
  readonly violations: string[] = [];
  aclRole = "owner";
  aclStatus = 200;
  /** Exact write ordinal; failed writes are never retried by this fake. */
  failPost?: { ordinal: number; mode: "before-apply" | "after-apply"; message?: string };
  beforePost?: (call: RemoteCall) => Promise<void>;
  afterPost?: (call: RemoteCall) => Promise<void>;
  patchMissingOnce = false;
  private version = 0;

  calls(kind: RemoteCall["kind"], method?: string): RemoteCall[] {
    return this.ledger.filter(call => call.kind === kind && (!method || call.method === method));
  }
  active(): RemoteEvent[] {
    return [...this.events.values()].flatMap(events => [...events.values()]).filter(event => event.status !== "cancelled");
  }
  private bucket(calendarId: string): Map<string, RemoteEvent> {
    let events = this.events.get(calendarId);
    if (!events) { events = new Map(); this.events.set(calendarId, events); }
    return events;
  }
  private stamp(body: RemoteBody): RemoteEvent {
    this.version++;
    return { ...structuredClone(body), status: "confirmed", etag: `"synthetic-${this.version}"`, updated: `2099-11-30T00:00:${String(this.version % 60).padStart(2, "0")}.000Z` };
  }
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    try { return await this.respond(input, init); }
    catch (error) {
      // Expected response loss is a remote fault. Assertion/tripwire failures must
      // remain observable even when the real client catches and sanitizes them.
      if (error instanceof assert.AssertionError || (error instanceof Error && error.message.startsWith("UNEXPECTED_SYNTHETIC_FETCH"))) {
        this.violations.push(String(error));
      }
      throw error;
    }
  };
  private async respond(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers);
    const source = init?.body;
    const body: unknown = typeof source === "string" && source.startsWith("{") ? JSON.parse(source) : String(source ?? "");
    const call: RemoteCall = { kind: "event", method, url: url.toString(), body, sendUpdates: url.searchParams.get("sendUpdates"), ifMatch: headers.get("If-Match") };
    const response = (status: number, value: unknown = {}) => {
      call.status = status;
      return status === 204 ? new Response(null, { status }) : Response.json(value, { status });
    };
    if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
      call.kind = "oauth"; this.ledger.push(call);
      assert.equal(method, "POST");
      const fields = new URLSearchParams(String(source));
      assert.equal(fields.get("client_id"), "synthetic-calendar-client");
      assert.equal(fields.get("client_secret"), "synthetic-calendar-secret");
      assert.equal(fields.get("refresh_token"), "synthetic-calendar-refresh");
      assert.equal(fields.get("grant_type"), "refresh_token");
      return response(200, { access_token: "synthetic-calendar-token", expires_in: 3600 });
    }
    if (url.origin === "https://slack.com" && url.pathname.startsWith("/api/")) {
      call.kind = "slack"; this.ledger.push(call);
      // Tests currently require Slack0. Unexpected real notification attempts
      // are recorded and cannot escape to the network.
      return response(200, { ok: true, channel: { id: "synthetic-channel" }, user: { id: "synthetic-user" } });
    }
    if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/calendar/v3/")) {
      throw new Error("UNEXPECTED_SYNTHETIC_FETCH");
    }
    assert.equal(headers.get("Authorization"), "Bearer synthetic-calendar-token");
    assert.ok(init?.signal, "Real Calendar client must propagate an abort signal");
    if (init.signal.aborted) throw new Error(`${PRIVATE_MARKER}-aborted`);
    const acl = /^\/calendar\/v3\/users\/me\/calendarList\/([^/]+)$/.exec(url.pathname);
    if (acl) {
      call.kind = "acl"; call.calendarId = decodeURIComponent(acl[1]); this.ledger.push(call);
      assert.equal(method, "GET");
      return response(this.aclStatus, this.aclStatus === 200 ? { accessRole: this.aclRole } : { error: PRIVATE_MARKER });
    }
    const eventPath = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
    if (!eventPath) throw new Error("UNEXPECTED_SYNTHETIC_FETCH calendar path");
    call.calendarId = decodeURIComponent(eventPath[1]); call.eventId = eventPath[2] && decodeURIComponent(eventPath[2]);
    this.ledger.push(call);
    const events = this.bucket(call.calendarId);
    if (method === "POST" && !call.eventId) {
      const value = body as RemoteBody;
      assert.equal(typeof value.id, "string"); assert.ok(value.start && value.end);
      call.eventId = value.id;
      const fault = this.failPost?.ordinal === this.calls("event", "POST").length ? this.failPost : undefined;
      await this.beforePost?.(call);
      if (fault?.mode === "before-apply") return response(503, { error: fault.message ?? PRIVATE_MARKER });
      if (events.has(value.id)) return response(409, { error: "synthetic conflict" });
      events.set(value.id, this.stamp(value));
      await this.afterPost?.(call);
      if (fault?.mode === "after-apply") throw new Error(fault.message ?? `${PRIVATE_MARKER}-response-lost`);
      return response(201, structuredClone(events.get(value.id)));
    }
    if (method === "GET" && !call.eventId) return response(200, { items: [...events.values()].map(event => structuredClone(event)) });
    const event = call.eventId ? events.get(call.eventId) : undefined;
    if (method === "GET") return event ? response(200, structuredClone(event)) : response(404);
    if (method === "PATCH" || method === "DELETE") {
      if (!event || event.status === "cancelled") return response(404);
      if (call.ifMatch && call.ifMatch !== event.etag) return response(412);
      if (method === "PATCH" && this.patchMissingOnce) {
        this.patchMissingOnce = false; event.status = "cancelled"; return response(404);
      }
      if (method === "DELETE") { event.status = "cancelled"; return response(204); }
      events.set(event.id, this.stamp({ ...event, ...body as Partial<RemoteBody> }));
      return response(200, structuredClone(events.get(event.id)));
    }
    throw new Error("UNEXPECTED_SYNTHETIC_FETCH calendar method");
  }
}
