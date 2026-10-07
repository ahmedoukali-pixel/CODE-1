from pydantic import BaseModel, Field
from typing import List

class SensorData(BaseModel):
    temperature: float = Field(..., description="Temperature in °C")
    moisture: float = Field(..., description="Soil Moisture percentage")
    pH: float = Field(..., description="Soil pH level")
    battery: float = Field(..., description="Battery level percentage")
    humidity: float = Field(..., description="Ambient humidity percentage")
    light: int = Field(..., description="Light intensity lux")
    nitrogen: int = Field(..., description="Nitrogen ppm")
    phosphorus: int = Field(..., description="Phosphorus ppm")
    potassium: int = Field(..., description="Potassium ppm")
    signalStrength: int = Field(..., description="Signal strength %")
    raw_message: str | None = Field(None, description="Raw text message from sensor")

class SensorState(BaseModel):
    sensor_id: str = Field(..., description="Unique ID like S-01, S-02")
    timestamp: str = Field(..., description="ISO format UTC timestamp")
    status: str = Field(..., description="ONLINE or OFFLINE")
    is_real: bool = Field(False, description="True if hardware-backed")
    data: SensorData

class TwinStatePayload(BaseModel):
    sensors: List[SensorState] = Field(..., description="Array of all 25 sensor states")
