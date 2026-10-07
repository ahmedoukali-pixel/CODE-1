import asyncio
from fastapi import WebSocket
from backend.models import TwinStatePayload

class ConnectionManager:
    def __init__(self):
        self.active_connections: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self.lock:
            self.active_connections.add(websocket)

    async def disconnect(self, websocket: WebSocket):
        async with self.lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    async def broadcast_state(self, payload: TwinStatePayload):
        """
        Safely broadcast the Pydantic TwinStatePayload to all connected clients.
        Automatically removes dead connections.
        """
        message = payload.model_dump_json()
        dead_connections = set()
        
        # Take a snapshot of the set to iterate safely
        async with self.lock:
            connections_snapshot = list(self.active_connections)
            
        for connection in connections_snapshot:
            try:
                await connection.send_text(message)
            except Exception:
                dead_connections.add(connection)
                
        if dead_connections:
            async with self.lock:
                self.active_connections.difference_update(dead_connections)

# Global singleton
manager = ConnectionManager()
