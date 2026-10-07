import asyncio
import time
import random
from datetime import datetime

from backend.models import TwinStatePayload, SensorState, SensorData
from backend.websocket_manager import manager
from backend.nrf_receiver import NRFHardware

class DigitalTwinEngine:
    def __init__(self):
        self.hardware = NRFHardware()
        self.is_running = False
        
        # Track hardware offline state
        self.s01_last_seen = time.time()
        self.offline_threshold = 10.0 # seconds
        
        # Initialize 25 sensors
        self.sensors = self._initialize_sensors()

    def _initialize_sensors(self) -> list[dict]:
        sensors = []
        for i in range(25):
            # Zone definitions (5x5 grid)
            # A: 0-4, B: 5-9, C: 10-14, D: 15-19, E: 20-24
            row = i // 5
            col = i % 5
            
            # Base values varied slightly by zone
            base_moisture = 60 - (row * 5) + random.uniform(-5, 5)
            base_temp = 20 + (col * 1) + random.uniform(-1, 1)
            base_ph = 6.5 + random.uniform(-0.2, 0.2)
            
            sensors.append({
                "id": f"S-{(i+1):02d}",
                "is_real": (i == 0),
                "status": "ONLINE",
                "moisture": base_moisture,
                "temperature": base_temp,
                "pH": base_ph,
                "battery": 100.0 if i == 0 else random.uniform(40, 95),
                "nitrogen": int(random.uniform(30, 45)),
                "phosphorus": int(random.uniform(20, 35)),
                "potassium": int(random.uniform(40, 60))
            })
        return sensors

    async def run_loop(self):
        """
        Unified real-time engine loop. Runs deterministically.
        Updates physics for S-02..S-25, polls hardware for S-01.
        """
        self.is_running = True
        
        while self.is_running:
            # Deterministic loop timer (1 second ticks)
            await asyncio.sleep(1.0)
            current_time = time.time()
            
            # 1. Update Hardware (S-01)
            # Clear previous raw message so it only broadcasts exactly when received
            s01 = self.sensors[0]
            if "raw_message" in s01:
                s01["raw_message"] = None
                
            packet = self.hardware.read_packet()
            
            if packet:
                # Real hardware data received!
                self.s01_last_seen = current_time
                s01["status"] = "ONLINE"
                
                if isinstance(packet, str):
                    # We received a text message (like "hello")
                    s01["raw_message"] = packet
                else:
                    # We received a numeric tuple
                    s01["temperature"] = packet[0]
                    s01["moisture"] = packet[1]
                    s01["pH"] = packet[2]
            else:
                if self.hardware.is_initialized:
                    # Hardware mode active, but no packet. Check timeout.
                    if current_time - self.s01_last_seen > self.offline_threshold:
                        s01["status"] = "OFFLINE"
                else:
                    # Hardware not available; run S-01 in simulation fallback
                    self._apply_physics(s01)
                    if random.random() < 0.15:
                        s01["raw_message"] = random.choice(["hello", "hello", "system_test_ok", "hello"])
            
            # 2. Update Simulated Sensors (S-02 to S-25)
            for i in range(1, 25):
                self._apply_physics(self.sensors[i])
            
            # 3. Build unified payload
            payload = self._build_twin_payload()
            
            # 4. Broadcast
            await manager.broadcast_state(payload)

    def _apply_physics(self, s: dict):
        """Applies realistic environmental decay and variation."""
        # Slow decay of moisture
        s["moisture"] = max(0, min(100, s["moisture"] - random.uniform(0.1, 0.3)))
        # Temperature wave
        s["temperature"] = max(5, min(45, s["temperature"] + random.uniform(-0.2, 0.2)))
        # pH drift
        s["pH"] = max(4.5, min(8.5, s["pH"] + random.uniform(-0.01, 0.01)))
        # Battery drain
        s["battery"] = max(0, s["battery"] - random.uniform(0, 0.005))

    def _build_twin_payload(self) -> TwinStatePayload:
        timestamp = datetime.utcnow().isoformat() + "Z"
        sensor_states = []
        
        for s in self.sensors:
            # Calculate derived metrics based on current core state
            hum = max(20, min(100, 60 - (100 - s["moisture"])*0.2 + random.uniform(-1, 1)))
            light = int(random.uniform(50000, 80000))
            sig = 0 if s["status"] == "OFFLINE" else int(random.uniform(85, 100))
            
            data = SensorData(
                temperature=round(s["temperature"], 1),
                moisture=round(s["moisture"], 1),
                pH=round(s["pH"], 2),
                battery=round(s["battery"], 1),
                humidity=round(hum, 1),
                light=light,
                nitrogen=s["nitrogen"],
                phosphorus=s["phosphorus"],
                potassium=s["potassium"],
                signalStrength=sig,
                raw_message=s.get("raw_message")
            )
            
            state = SensorState(
                sensor_id=s["id"],
                timestamp=timestamp,
                status=s["status"],
                is_real=s["is_real"],
                data=data
            )
            sensor_states.append(state)
            
        return TwinStatePayload(sensors=sensor_states)

# Global engine instance
engine = DigitalTwinEngine()
