class NRFHardware:
    def __init__(self):
        self.is_initialized = False
        self.nrf = None
        
        try:
            import board
            import digitalio
            from circuitpython_nrf24l01.rf24 import RF24

            spi = board.SPI()
            ce_pin = digitalio.DigitalInOut(board.D22)
            csn_pin = digitalio.DigitalInOut(board.D8)

            self.nrf = RF24(spi, csn_pin, ce_pin)
            self.nrf.pa_level = -12
            self.nrf.open_rx_pipe(1, b"1Node")
            self.nrf.listen = True
            
            self.is_initialized = True
            print("[OK] NRF24L01 Hardware initialized successfully.")
        except ImportError:
            print("[WARN] NRF24L01 libraries not found. Running in simulation mode.")
        except Exception as e:
            print(f"[WARN] NRF24L01 Hardware failed to initialize: {e}. Running in simulation mode.")

    def read_packet(self) -> tuple[float, float, float] | str | None:
        """
        Reads a packet from the NRF24L01.
        Returns (temperature, moisture, ph) OR a string message OR None.
        """
        if not self.is_initialized or not self.nrf:
            return None
            
        if self.nrf.any():
            try:
                buffer = self.nrf.read()
                if not buffer:
                    return None
                    
                # First, try to decode as an ASCII string (e.g. for "hello" test messages)
                try:
                    text = buffer.split(b'\x00')[0].decode('utf-8').strip()
                    # A basic heuristic: if it's mostly text, return it as string
                    if text and text.isprintable() and len(text) > 1:
                        return text
                except Exception:
                    pass
                
                # Fallback to PIC16F877A Lightweight Binary Protocol (4 bytes)
                # Byte 0 = Sensor ID (1 for S-01)
                # Byte 1 = Temperature (deg C)
                # Byte 2 = Soil Moisture (%)
                # Byte 3 = Soil pH * 10
                
                if len(buffer) >= 4:
                    sensor_id = buffer[0]
                    if sensor_id == 1:
                        temp = float(buffer[1])
                        moisture = float(buffer[2])
                        ph = float(buffer[3]) / 10.0
                        return (temp, moisture, ph)
                    else:
                        print(f"[WARN] Invalid Sensor ID: {sensor_id}")
                else:
                    print("[WARN] Invalid packet length received.")
            except Exception as e:
                print(f"[WARN] Error parsing NRF binary buffer: {e}")
        
        return None
