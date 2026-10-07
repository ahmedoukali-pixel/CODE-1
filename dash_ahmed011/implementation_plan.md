# Live Hardware Log Stream Implementation Plan

The goal is to modify the system to natively support parsing and displaying raw string messages (like `"hello"`) received from the PIC16F877A on node S-01, displaying them in a live, scrolling history log on the frontend.

## Proposed Changes

### 1. Backend Data Models
To safely send the text payload from the backend to the frontend without triggering `ValidationError`s, we will update the Pydantic schema.

#### [MODIFY] `models.py`
- Add `raw_message: str | None = Field(None)` to the `SensorData` class.

### 2. Backend Hardware Logic
We need to update the NRF receiver and the engine loop to detect and handle string packets cleanly.

#### [MODIFY] `nrf_receiver.py`
- Update `NRFHardware.read_packet()` to attempt decoding the byte buffer as an ASCII/UTF-8 string. If the PIC sends `"hello"`, it will return the string instead of a numerical tuple.

#### [MODIFY] `sensor_service.py`
- In `run_loop()`, clear `s01["raw_message"] = None` at the start of every tick to ensure we only broadcast the message exactly when it is received.
- If `packet` is a string, assign it to `s01["raw_message"]`.
- Update `_build_twin_payload()` to map the `raw_message` into the payload.

### 3. Frontend UI (Dashboard)
We will create a dedicated container to display the logs in real-time.

#### [MODIFY] `index.html`
- Add a new "Hardware Communication Log (S-01)" card to the right column of the dashboard (underneath the Alerts preview).
- This container will have a fixed height with `overflow-y: auto` to allow scrolling.

#### [MODIFY] `script.js`
- Update `wsConnection.onmessage` to parse `d.raw_message`.
- If a message exists, dynamically create a new `<div>` containing `S-01 | <timestamp> | <message>` and use `appendChild()` to stack it.
- Implement auto-scroll logic (`logContainer.scrollTop = logContainer.scrollHeight`) to always keep the latest messages in view.

## Verification Plan
- **Mock Trigger**: I will temporarily inject a "hello" message in the backend loop to verify the UI stacks the logs correctly and scrolls automatically.
- **Hardware Test**: Once approved and implemented, you can power up the PIC16F877A and watch the dashboard log stream populate in real-time without overwriting.

> [!IMPORTANT]
> Please review this plan. If you approve, I will immediately execute the changes across the full stack.
