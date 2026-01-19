import zmq
import zmq.asyncio
import orjson
from typing import Callable

class ZMQReceiver:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.context = zmq.asyncio.Context()
        self.socket = self.context.socket(zmq.PULL)
        self.message_count = 0

    async def connect(self):
        """Connect to ZMQ endpoint"""
        self.socket.connect(self.endpoint)
        print(f"[ZMQ] Connected to {self.endpoint}")

    async def receive_loop(self, callback: Callable):
        """
        Continuously receive messages and invoke callback.

        Args:
            callback: Async function to process each message
        """
        print("[ZMQ] Starting receive loop...")

        while True:
            try:
                message_bytes = await self.socket.recv()
                self.message_count += 1

                # Fast JSON parsing with orjson
                data = orjson.loads(message_bytes)

                # Invoke callback (non-blocking)
                await callback(data)

            except Exception as e:
                print(f"[ZMQ] Receive error: {e}")
                # Don't crash on errors, keep processing

    def get_stats(self):
        return {
            'messages_received': self.message_count,
            'endpoint': self.endpoint
        }

    def close(self):
        self.socket.close()
        self.context.term()
