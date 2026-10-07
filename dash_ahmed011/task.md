# Live Hardware Log Stream Implementation Tasks

- `[/]` **1. Backend Models**: Add `raw_message` to `SensorData` in `models.py`
- `[ ]` **2. NRF Receiver**: Modify `nrf_receiver.py` to decode byte payloads as strings
- `[ ]` **3. Sensor Service**: Update `sensor_service.py` to handle string packets and map to `raw_message`
- `[ ]` **4. Frontend HTML**: Add the hardware log container in `index.html`
- `[ ]` **5. Frontend JS**: Add WebSocket parsing, DOM appending, and auto-scroll logic in `script.js`
- `[ ]` **6. Verification**: Restart backend and test functionality
