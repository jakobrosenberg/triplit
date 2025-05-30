import { ClientSyncMessage, CloseReason } from '../@triplit/types/sync.js';
import {
  ConnectionStatus,
  SyncTransport,
  TransportConnectParams,
} from '../types.js';

export class HttpTransport implements SyncTransport {
  private eventSource: EventSource | undefined;

  private closeCallback: ((ev: any) => void) | undefined;
  private transportOptions: TransportConnectParams | undefined;

  constructor() {}

  get isOpen(): boolean {
    return (
      !!this.eventSource &&
      this.eventSource.readyState === this.eventSource.OPEN
    );
  }

  get connectionStatus(): ConnectionStatus {
    return this.eventSource ? friendlyReadyState(this.eventSource) : 'CLOSED';
  }

  onOpen(callback: (ev: any) => void): void {
    if (this.eventSource) this.eventSource.onopen = callback;
  }

  sendMessage(message: ClientSyncMessage): boolean {
    if (!this.transportOptions) return false;
    if (!this.isOpen) return false;

    const { token, server } = this.transportOptions;

    const uri = `${server}/message`;
    fetch(uri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message,
        options: {},
      }),
    }).catch((err) => {
      console.error(err);
      // I think we just swallow the error here, since we're not connected to the server?
      // Equivalent to websocket "closed"
    });
    return true;
  }

  onMessage(callback: (message: any) => void): void {
    if (this.eventSource) this.eventSource.onmessage = callback;
  }

  onError(callback: (ev: any) => void): void {
    if (this.eventSource) this.eventSource.onerror = callback;
  }
  // Set up a server sent event stream
  connect(params: TransportConnectParams): void {
    if (this.eventSource) this.close();
    const { token, schema, syncSchema, server } = params;
    const eventSourceOptions = new URLSearchParams();
    if (schema) {
      eventSourceOptions.set('schema', schema.toString());
    }
    eventSourceOptions.set('sync-schema', String(syncSchema));
    eventSourceOptions.set('token', token);
    const eventSourceUri = `${server}/message-events?${eventSourceOptions.toString()}`;
    this.eventSource = new EventSource(eventSourceUri);
    this.transportOptions = params;
  }
  close(reason?: CloseReason): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource.dispatchEvent(new Event('close'));
      if (this.closeCallback) {
        this.closeCallback({ reason: JSON.stringify(reason) });
      }
      this.closeCallback = undefined;
      this.transportOptions = undefined;
    }
  }

  onClose(callback: (ev: any) => void): void {
    this.closeCallback = callback;
  }

  onConnectionChange(callback: (state: ConnectionStatus) => void): void {
    if (this.eventSource) this.eventSource.onconnectionchange = callback;
  }
}

declare global {
  interface EventSource {
    onconnectionchange: (status: ConnectionStatus) => void;
  }
}

function friendlyReadyState(conn: EventSource): ConnectionStatus {
  switch (conn.readyState) {
    case conn.CONNECTING:
      return 'CONNECTING';
    case conn.OPEN:
      return 'OPEN';
    case conn.CLOSED:
    // Default to closed... this shouldnt happen and probably indicates something is wrong
    default:
      return 'CLOSED';
  }
}

// temporary defensive check for node env
if (typeof window !== 'undefined') {
  // Add any changes to the WebSocket type here (ex more event handlers)
  var EventSourceProxy = new Proxy(EventSource, {
    construct: function (target, args) {
      const instance = new target(
        // @ts-ignore
        ...args
      );

      function dispatchConnectionChangeEvent() {
        instance.dispatchEvent(new Event('connectionchange'));
        if (
          instance.onconnectionchange &&
          typeof instance.onconnectionchange === 'function'
        ) {
          instance.onconnectionchange(friendlyReadyState(instance));
        }
      }

      // Capture the connecting state after the constructor is called
      setTimeout(function () {
        dispatchConnectionChangeEvent();
      }, 0);

      const openHandler = () => {
        dispatchConnectionChangeEvent();
      };

      const closeHandler = () => {
        dispatchConnectionChangeEvent();
        instance.removeEventListener('open', openHandler);
        instance.removeEventListener('close', closeHandler);
      };

      instance.addEventListener('open', openHandler);
      instance.addEventListener('close', closeHandler);

      return instance;
    },
  });

  // replace the native EventSource with the proxy
  EventSource = EventSourceProxy;
}
