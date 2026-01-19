### **Proyecto: \"The Arbitrage Sniper\" (Motor de Arbitraje de Alta Frecuencia Simulado)**

**Objetivo:** Crear un sistema híbrido que detecte diferencias de precio
(arbitraje) de Bitcoin entre dos \"Exchanges\" en tiempo real (\<5ms de
latencia interna) y simule órdenes de ejecución.

**Tiempo estimado:** 48 horas (Modo Hackathon).

### **La Arquitectura (El Reto)**

No usarás HTTP para comunicar los servicios. Usarás **ZeroMQ (0MQ)**
para comunicación de ultra-baja latencia entre procesos.

1.  **Node.js (The Ingestor / Gateway):**

    - Se conecta vía **WebSockets** reales a dos fuentes públicas (ej.
      Binance y Coinbase/Kraken, o el de tu preferencia.) escuchando el
      par BTC/USDT.

    - Normaliza los datos \"on the fly\".

    - Envía los datos normalizados al motor de Python vía **ZeroMQ (PUSH
      socket)**.

    - Expone un WebSocket (Socket.io) para un dashboard frontend simple.

2.  **Python (The Quant Engine):**

    - Escucha los datos vía **ZeroMQ (PULL socket)**.

    - Mantiene un libro de órdenes (Order Book) simplificado en memoria.

    - Calcula el *spread* (diferencia de precio) en tiempo real.

    - Si el spread supera un umbral (ej. 0.5%), dispara una señal de
      \"COMPRA A / VENDE B\". "SIMULADO"

    - Escribe la señal en **Redis** para persistencia y notifica a
      Node.js (vía **PUB/SUB** de Redis o otro socket ZMQ) para que
      actualice el dashboard.

### **Requisitos Técnicos (Constraints)**

Debes cumplir estas reglas:

1.  **Python Performance:** Debes usar asyncio con uvloop (reemplazo del
    event loop estándar) para máxima velocidad. Nada de Flask/Django.
    Script puro o FastAPI si necesitas estructura.

2.  **Node.js Performance:** El ingestor no puede bloquearse. Debe
    manejar la desconexión y reconexión de los WebSockets de los
    exchanges automáticamente.

3.  **Dockerizado:** Todo debe levantarse con un solo docker-compose up.

4.  **No DB tradicional:** No uses Postgres/MySQL. Todo es en memoria
    (volátil) o Redis (caché). La velocidad es la prioridad.

**Nota adicional:** Para los datos de mercado, puedes usar los exchanges
de tu preferencia o usar datos simulados.

Debes entregar tu repositorio con el proyecto completado y un video
demostrando como funciona tu solución. Y enviarlo a
[[hector@oberstaff.com]{.underline}](mailto:hector@oberstaff.com) y
[[natacha@oberstaff.com]{.underline}](mailto:natacha@oberstaff.com)
