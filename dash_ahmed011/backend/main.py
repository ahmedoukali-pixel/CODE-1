import asyncio
import os
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.websocket_manager import manager
from backend.sensor_service import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[INFO] Starting SCADA Digital Twin Engine...")
    task = asyncio.create_task(engine.run_loop())
    yield
    engine.is_running = False
    task.cancel()
    print("[INFO] SCADA Digital Twin Engine stopped.")


app = FastAPI(title="Industrial Digital Twin SCADA Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/sensors")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive; handle client pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket exception: {e}")
        await manager.disconnect(websocket)


# Serve frontend files
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(frontend_dir, "index.html"))


@app.get("/{filename:path}")
async def serve_static(filename: str):
    """Serve static frontend files but block access to the backend directory."""
    if filename.startswith("backend"):
        return FileResponse(os.path.join(frontend_dir, "index.html"), status_code=404)
    filepath = os.path.join(frontend_dir, filename)
    if os.path.isfile(filepath):
        return FileResponse(filepath)
    return FileResponse(os.path.join(frontend_dir, "index.html"))


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
