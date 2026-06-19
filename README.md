# CondoSmart - Sistema de Gestión Integral de Condominios

Este sistema integra operaciones, finanzas, seguridad y telemetría hídrica en una plataforma única y responsiva para la junta y los residentes de la comunidad en Fuerte Tiuna.

## Requisitos Previos

- **Python 3.12+**
- Librerías necesarias (instaladas automáticamente en tu entorno):
  - `flask`
  - `flask-cors`
  - `pyjwt`
  - `bcrypt`
  - `websockets`

## Estructura del Proyecto

- `server.py`: Servidor HTTP REST API (Flask, puerto 5000) y servidor WebSockets (puerto 5001) para telemetría y logs en tiempo real.
- `database.py`: Creación del esquema relacional en SQLite y sembrado de datos iniciales (*seeders*).
- `public/`: Archivos estáticos de la Single Page Application (SPA).
  - `index.html`: Wireframes unificados e interactivos de CondoSmart.
  - `app.js`: Lógica interactiva de cliente, simuladores, JWT y gráficos en vivo.
  - `styles.css`: Estilos visuales personalizados y glassmorphism.

## Instrucciones de Ejecución

1. **Ejecutar el Servidor:**
   Abre una consola en el directorio raíz del proyecto y ejecuta:
   ```bash
   python server.py
   ```
   *Nota: Si la base de datos `condosmart.db` no existe, se inicializará y sembrará automáticamente.*

2. **Acceder a la Aplicación:**
   Abre tu navegador de preferencia y ve a:
   [http://localhost:5000](http://localhost:5000)

## Credenciales de Acceso Demo

| Perfil | Correo Electrónico | Contraseña |
| :--- | :--- | :--- |
| **Administrador** | `admin@condosmart.com` | `admin123` |
| **Residente** | `residente@condosmart.com` | `residente123` |
| **Vigilante** | `vigilante@condosmart.com` | `vigilante123` |
| **Técnico** | `tecnico@condosmart.com` | `tecnico123` |

## Módulos y Simulaciones en Vivo

- **Finanzas (ACID):** El residente puede reportar transferencias cargando imágenes de comprobantes. El administrador los aprueba/rechaza en tiempo real, actualizando balances en la base de datos de manera transaccional. Además, se simula la facturación mensual prorrateada por alícuotas con recarga del 2% por morosidad.
- **Acceso Biométrico / QR:** Genera códigos QR temporales para visitas que expiran en 24 horas. Simula escaneos de huellas o rostros peatonales y NFC vehicular desde la UI para generar bitácoras de accesos.
- **CCTV y Seguridad:** Panel interactivo del vigilante con cuadrícula de cámaras simuladas en vivo e historial de accesos WebSocket en tiempo real.
- **Telemetría Hídrica:** El panel muestra presión en vivo (fluctuando en ~44 PSI). Puedes simular fallos de bomba o fugas desde el panel de operaciones del Administrador; la presión caerá y disparará alertas en pantalla e inyecciones automáticas de registros en bitácora de incidentes.
- **Vista de Base de Datos:** Los administradores pueden inspeccionar las tablas relacionales de la base de datos directamente desde el panel para máxima transparencia de datos.
