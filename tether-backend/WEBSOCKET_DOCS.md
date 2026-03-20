# Tether WebSocket & Backend Documentation

This document explains the architecture and expected object structures for the Tether backend which acts as a relay between the VS Code Extension (`extension`) and the Mobile App (`mobile`).

## 1. Overview

The backend uses **Express** for REST endpoints (pairing generation and status) and **ws** for WebSocket connections (the actual relay). 
State is managed using **Redis** for distributed persistence of pairing codes and their statuses, while active WebSocket connections are stored in **memory**.

---

## 2. REST Endpoints

### Generate Pairing Code
- **Method:** `POST`
- **Path:** `/pair/generate`
- **Response:**
  ```json
  {
    "code": "A1B2C3D4",
    "expiresInSeconds": 300
  }
  ```

### Check Pairing Status
- **Method:** `GET`
- **Path:** `/pair/status/:code`
- **Response:**
  ```json
  {
    "status": "waiting" | "extension_connected" | "paired" | "disconnected",
    "ttl": 298
  }
  ```
  *(If the code has expired or does not exist, it returns `{"status": "expired", "ttl": 0}`)*

---

## 3. WebSocket Connection

**Endpoint:** `ws://<host>:<port>/ws`

### The Registration Phase

When a client first connects to the WebSocket endpoint, it **must** register itself within 60 seconds. If it fails to send a valid registration message in time, the server will close the connection with code `4000`.

**Registration Message Object:**
```typescript
interface RegisterMessage {
  type: "register";
  role: "extension" | "mobile";
  code: string; // Must be 8 characters, uppercase alphanumeric
}
```

#### Connection Flow & Expected Responses

1. **Extension Connects:** The VS Code extension connects first and sends a `register` message.
   - **Success Response:**
     ```json
     {
       "type": "registered",
       "code": "A1B2C3D4",
       "status": "waiting_for_mobile"
     }
     ```
2. **Mobile Connects:** Once the extension is waiting, the mobile app connects using the exact same code and sends a `register` message.
   - **Success Response:** Sent to **both** the extension and the mobile app:
     ```json
     {
       "type": "paired",
       "code": "A1B2C3D4"
     }
     ```

#### Error Responses during Registration
If something goes wrong (invalid role, invalid code, wrong order, duplicate connections), the socket will receive an error and close:
```json
{
  "type": "error",
  "message": "<Error Reason>"
}
```

---

## 4. The Relay Phase

Once both the `extension` and the `mobile` app have registered to the same session code and received the `paired` event, they enter the relay phase.

In this phase, **any valid JSON message** sent by one peer is passed completely raw and unchanged to the other peer, with **one** exception: the server will inject a `from` property indicating who sent the message.

**Example Mobile sending a command:**
*Mobile sends:* 
```json
{ "type": "command", "action": "run_script" }
```
*Extension receives:* 
```json
{ "type": "command", "action": "run_script", "from": "mobile" }
```

---

## 5. Disconnection Events

If either the `extension` or the `mobile` app drops their WebSocket connection, the backend will notify the surviving peer.

**Peer Disconnected Message:**
```json
{
  "type": "peer_disconnected",
  "role": "extension" | "mobile"
}
```
The session will remain active in memory until both peers have disconnected, at which point the session is cleaned up and the code status in Redis is marked as `"disconnected"`.

---

## 6. Internal Data Models

For backend developers, the state is represented using the following structures:

### Redis Store (`PairRecord`)
```typescript
interface PairRecord {
  status: "waiting" | "extension_connected" | "paired" | "disconnected";
  createdAt: number;
}
```

### In-Memory Store (`Session`)
```typescript
interface Session {
  code: string;
  extensionSocket: WebSocket | null;
  mobileSocket: WebSocket | null;
  pairedAt: number | null;
}
```
