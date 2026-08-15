# Socket.IO transport — TIMTTO real-time notifications

Reference: `openspec/changes/realtime-notifications-infrastructure/design.md` (D1–D3).

## Connecting

```js
import { io } from 'socket.io-client';

const socket = io(SOCKET_URL, {
  auth: { token: jwt }, // same JWT used for the Authorization: Bearer header
  transports: ['websocket', 'polling'],
  reconnection: true,
});
```

- `SOCKET_URL` is the same host/port as the REST API (Socket.IO is mounted on
  the same `httpServer` Express listens on — no separate port).
- The JWT MUST be sent via `auth.token` in the handshake, never as a query
  string param or cookie. Query strings leak into proxy logs; cross-origin
  cookies (Vercel frontend + Railway backend) don't work reliably.
- If the token is missing, malformed, or expired, the server rejects the
  handshake and the client receives a `connect_error` event. Reconnect with a
  freshly refreshed token (same flow the Axios interceptor already uses).

## Server-side room assignment (never client-driven)

On a successful handshake the server automatically joins the socket to three
rooms, derived exclusively from the verified JWT claims:

| Room | Purpose |
|---|---|
| `user:{userId}` | Direct push to one specific user — this is what `notificationService.emit` targets for the `inapp` channel. |
| `tenant:{tenantId}` | Broadcast to every connected user of a tenant (rarely used; reserved for system-wide announcements). |
| `tenant:{tenantId}:role:{role}` | Broadcast to every connected user with a given role in a tenant. |

**There are no client-emittable `join`/`leave` events.** The server registers
zero inbound event handlers beyond the `connection` event itself. A client
cannot request to join an arbitrary room — the only rooms a socket will ever
be a member of are the three listed above, computed server-side in the
`io.use(...)` handshake middleware (`src/socket/index.js`).

## Events

### Server → Client

| Event | Payload | When |
|---|---|---|
| `notification` | The persisted `Notification` document (`{ _id, tenantId, userId, event, title, body, data, channels, readAt, createdAt }`) | Emitted to `user:{userId}` by `notificationService.emit(...)` whenever a recipient resolves to the `inapp` channel and is not muted via `NotificationPreference`. |

### Client → Server

None. This transport is delivery-only in phase 1. Any future client-emitted
event (e.g. read receipts over the socket instead of REST) must go through
adversarial review before being added, since every inbound handler is a new
attack surface for cross-tenant/cross-user access.

## Scaling note

Single Railway dyno today — no `@socket.io/redis-adapter`. If the backend
scales to N dynos, each dyno only emits to the sockets connected to it,
splitting the audience. Documented in `docs/data-model.md` (Realtime /
Socket.IO section) and `design.md` Risks — adding the Redis adapter is a
~20-line change when needed.
