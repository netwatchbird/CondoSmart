import os
import sys
import json
import sqlite3
import datetime
import jwt
import bcrypt
import threading
import asyncio
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
import websockets

app = Flask(__name__, static_folder="public")
CORS(app)

JWT_SECRET = os.environ.get("JWT_SECRET", "condosmart_secret_key_2026")
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "condosmart.db")

# Global state for simulation
simulation_state = {
    "bomba_norte_estado": "Nominal",
    "presion_psi": 44.5,
    "leak_simulated": False
}

# Connected WebSocket clients
ws_clients = set()
loop = None

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# Helper function to check JWT
def token_required(f):
    def decorator(*args, **kwargs):
        token = None
        if "Authorization" in request.headers:
            auth_header = request.headers["Authorization"]
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
        
        if not token:
            return jsonify({"mensaje": "Token no proporcionado"}), 401
        
        try:
            data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            # Get user from db
            conn = get_db_connection()
            user = conn.execute("SELECT * FROM usuarios WHERE id = ?", (data["id"],)).fetchone()
            conn.close()
            if not user:
                return jsonify({"mensaje": "Usuario no encontrado"}), 401
            current_user = dict(user)
            del current_user["password_crypted"]
        except jwt.ExpiredSignatureError:
            return jsonify({"mensaje": "El token ha expirado"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"mensaje": "Token invalido"}), 401
        
        return f(current_user, *args, **kwargs)
    decorator.__name__ = f.__name__
    return decorator

# Helper function to check roles
def roles_allowed(*roles):
    def decorator(f):
        def wrapper(current_user, *args, **kwargs):
            if current_user["rol"] not in roles:
                return jsonify({"mensaje": "Acceso denegado: rol insuficiente"}), 403
            return f(current_user, *args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator

# Log event helper
def log_event(usuario_id, accion, detalles):
    conn = get_db_connection()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO bitacora (usuario_id, accion, detalles, timestamp) VALUES (?, ?, ?, ?)",
        (usuario_id, accion, detalles, now)
    )
    conn.commit()
    conn.close()
    
    # Broadcast log event to websockets
    broadcast_data({
        "type": "log",
        "timestamp": now,
        "accion": accion,
        "detalles": detalles,
        "usuario_id": usuario_id
    })

# Helper to broadcast websocket messages
def broadcast_data(data):
    if not loop:
        return
    message = json.dumps(data)
    asyncio.run_coroutine_threadsafe(send_to_all(message), loop)

async def send_to_all(message):
    if ws_clients:
        # Create a list to avoid mutating during iteration
        await asyncio.gather(*[client.send(message) for client in list(ws_clients)], return_exceptions=True)

# ----------------- HTTP ROUTES -----------------

# Serve frontend SPA files
@app.route("/")
def serve_index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def serve_static(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, "index.html")

# auth endpoint
@app.route("/api/v1/auth/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    correo = data.get("correo")
    password = data.get("password")
    
    if not correo or not password:
        return jsonify({"mensaje": "Correo y contraseña requeridos"}), 400
    
    conn = get_db_connection()
    user = conn.execute("SELECT * FROM usuarios WHERE correo = ?", (correo,)).fetchone()
    conn.close()
    
    if not user or not bcrypt.checkpw(password.encode('utf-8'), user["password_crypted"].encode('utf-8')):
        return jsonify({"mensaje": "Credenciales incorrectas"}), 401
    
    # Generate token
    token = jwt.encode({
        "id": user["id"],
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
    }, JWT_SECRET, algorithm="HS256")
    
    user_data = dict(user)
    del user_data["password_crypted"]
    
    log_event(user["id"], "Inicio de sesion", f"El usuario {user['nombre']} inicio sesion correctamente.")
    
    return jsonify({
        "token": token,
        "usuario": user_data
    })

@app.route("/api/v1/auth/me", methods=["GET"])
@token_required
def get_me(current_user):
    return jsonify(current_user)

# Get finance info
@app.route("/api/v1/finanzas/cuotas", methods=["GET"])
@token_required
def get_cuotas(current_user):
    conn = get_db_connection()
    if current_user["rol"] == "Residente":
        # Get resident's unit
        unit = conn.execute("SELECT * FROM unidades WHERE residente_id = ?", (current_user["id"],)).fetchone()
        if not unit:
            conn.close()
            return jsonify({"mensaje": "No tienes unidades asociadas"}), 404
        
        pagos = conn.execute("SELECT * FROM pagos WHERE unidad_id = ? ORDER BY id DESC", (unit["id"],)).fetchall()
        conn.close()
        
        return jsonify({
            "unidad": dict(unit),
            "pagos": [dict(p) for p in pagos]
        })
    else:
        # Admins get all units and payments
        unidades = conn.execute("""
            SELECT u.*, us.nombre as residente_nombre, us.correo as residente_correo 
            FROM unidades u 
            LEFT JOIN usuarios us ON u.residente_id = us.id
        """).fetchall()
        pagos = conn.execute("""
            SELECT p.*, u.numero_apartamento 
            FROM pagos p 
            JOIN unidades u ON p.unidad_id = u.id 
            ORDER BY p.id DESC
        """).fetchall()
        conn.close()
        
        return jsonify({
            "unidades": [dict(u) for u in unidades],
            "pagos": [dict(p) for p in pagos]
        })

# Report payment
@app.route("/api/v1/finanzas/reportar", methods=["POST"])
@token_required
@roles_allowed("Residente")
def reportar_pago(current_user):
    # Retrieve details
    monto = request.form.get("monto")
    referencia = request.form.get("referencia")
    metodo = request.form.get("metodo")
    concepto = request.form.get("concepto")
    
    if not monto or not referencia or not metodo or not concepto:
        return jsonify({"mensaje": "Todos los campos son obligatorios"}), 400
        
    comprobante_file = request.files.get("comprobante")
    filename = None
    if comprobante_file:
        filename = secure_filename(f"{datetime.datetime.now().timestamp()}_{comprobante_file.filename}")
        comprobante_file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))

    conn = get_db_connection()
    unit = conn.execute("SELECT id FROM unidades WHERE residente_id = ?", (current_user["id"],)).fetchone()
    if not unit:
        conn.close()
        return jsonify({"mensaje": "No tienes unidad asociada"}), 404

    now_date = datetime.date.today().strftime("%Y-%m-%d")
    conn.execute("""
        INSERT INTO pagos (unidad_id, monto, fecha, referencia, metodo, concepto, estado, comprobante_url)
        VALUES (?, ?, ?, ?, ?, ?, 'En Revision', ?)
    """, (unit["id"], float(monto), now_date, referencia, metodo, concepto, filename))
    
    conn.commit()
    conn.close()
    
    log_event(current_user["id"], "Reporte de pago", f"Residente reporto pago de {monto} Ref: {referencia}")
    return jsonify({"mensaje": "Pago reportado exitosamente, queda en revision"}), 201

# Validate payment (Admin)
@app.route("/api/v1/finanzas/validar", methods=["POST"])
@token_required
@roles_allowed("Administrador")
def validar_pago(current_user):
    data = request.get_json() or {}
    pago_id = data.get("pago_id")
    nuevo_estado = data.get("estado") # 'Pagado' or 'Rechazado'
    
    if not pago_id or nuevo_estado not in ("Pagado", "Rechazado"):
        return jsonify({"mensaje": "Campos invalidos"}), 400
        
    conn = get_db_connection()
    pago = conn.execute("SELECT * FROM pagos WHERE id = ?", (pago_id,)).fetchone()
    if not pago:
        conn.close()
        return jsonify({"mensaje": "Pago no encontrado"}), 404
        
    if pago["estado"] != "En Revision":
        conn.close()
        return jsonify({"mensaje": "El pago ya no esta en revision"}), 400
        
    # Transactional Update
    try:
        conn.execute("BEGIN TRANSACTION;")
        conn.execute("UPDATE pagos SET estado = ? WHERE id = ?", (nuevo_estado, pago_id))
        
        if nuevo_estado == "Pagado":
            # Subtract from unit's outstanding balance
            conn.execute(
                "UPDATE unidades SET saldo_actual = MAX(0.0, saldo_actual - ?) WHERE id = ?", 
                (pago["monto"], pago["unidad_id"])
            )
            
        conn.commit()
        log_event(current_user["id"], f"Validacion de pago: {nuevo_estado}", f"Pago ID {pago_id} validado como {nuevo_estado}.")
        return jsonify({"mensaje": f"Pago marcado como {nuevo_estado} exitosamente"})
    except Exception as e:
        conn.execute("ROLLBACK;")
        return jsonify({"mensaje": f"Error al procesar: {str(e)}"}), 500
    finally:
        conn.close()

# Get egresos
@app.route("/api/v1/finanzas/egresos", methods=["GET"])
@token_required
def get_egresos(current_user):
    conn = get_db_connection()
    egresos = conn.execute("SELECT * FROM egresos ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([dict(e) for e in egresos])

# Create egreso
@app.route("/api/v1/finanzas/egresos", methods=["POST"])
@token_required
@roles_allowed("Administrador")
def create_egreso(current_user):
    data = request.get_json() or {}
    concepto = data.get("concepto")
    monto = data.get("monto")
    
    if not concepto or not monto:
        return jsonify({"mensaje": "Campos obligatorios"}), 400
        
    now_date = datetime.date.today().strftime("%Y-%m-%d")
    conn = get_db_connection()
    conn.execute("INSERT INTO egresos (concepto, monto, fecha, soporte_pdf) VALUES (?, ?, ?, NULL)", 
                 (concepto, float(monto), now_date))
    conn.commit()
    conn.close()
    
    log_event(current_user["id"], "Registro de egreso", f"Se registro egreso de {monto} por concepto: {concepto}")
    return jsonify({"mensaje": "Egreso registrado exitosamente"}), 201

# Sim Cron Job for billing
@app.route("/api/v1/finanzas/cron_facturar", methods=["POST"])
@token_required
@roles_allowed("Administrador")
def cron_facturar(current_user):
    data = request.get_json() or {}
    gastos_comunes = data.get("gastos_comunes")
    
    if not gastos_comunes or float(gastos_comunes) <= 0:
        return jsonify({"mensaje": "Gasto comun invalido"}), 400
        
    gastos_comunes = float(gastos_comunes)
    
    conn = get_db_connection()
    try:
        conn.execute("BEGIN TRANSACTION;")
        unidades = conn.execute("SELECT * FROM unidades").fetchall()
        
        now_date = datetime.date.today().strftime("%Y-%m-%d")
        
        for u in unidades:
            # Prorrateo: Gasto * alicuota
            cargo_mensual = gastos_comunes * u["alicuota"]
            
            # Apply 2% interest if they have balance > 0 (overdue)
            interes = 0.0
            if u["saldo_actual"] > 0:
                interes = u["saldo_actual"] * 0.02
                # Log interest payment to billing
                conn.execute(
                    "INSERT INTO pagos (unidad_id, monto, fecha, referencia, metodo, concepto, estado) VALUES (?, ?, ?, 'SISTEMA', 'Cargo', 'Interes por Mora 2%', 'Pendiente')",
                    (u["id"], interes, now_date)
                )
            
            nuevo_saldo = u["saldo_actual"] + cargo_mensual + interes
            conn.execute("UPDATE unidades SET saldo_actual = ? WHERE id = ?", (nuevo_saldo, u["id"]))
            
            # Record invoice
            conn.execute(
                "INSERT INTO pagos (unidad_id, monto, fecha, referencia, metodo, concepto, estado) VALUES (?, ?, ?, 'SISTEMA', 'Cargo', 'Cuota de Mantenimiento', 'Pendiente')",
                (u["id"], cargo_mensual, now_date)
            )
            
        conn.commit()
        log_event(current_user["id"], "Facturacion colectiva", f"Se ejecuto facturacion por gasto comun total de {gastos_comunes} USD.")
        return jsonify({"mensaje": "Facturacion mensual procesada correctamente para todas las unidades."})
    except Exception as e:
        conn.execute("ROLLBACK;")
        return jsonify({"mensaje": f"Error de facturacion: {str(e)}"}), 500
    finally:
        conn.close()

# Validate biometric or QR access
@app.route("/api/v1/acceso/validar", methods=["POST"])
@token_required
@roles_allowed("Vigilante", "Administrador")
def validar_acceso(current_user):
    data = request.get_json() or {}
    tipo_acceso = data.get("tipo_acceso") # 'Biometrico', 'QR', 'PIN', 'Tag NFC'
    codigo_qr = data.get("codigo_qr")
    usuario_id = data.get("usuario_id") # For biometric or PIN
    nombre_visitante = data.get("nombre_visitante")
    puerta = data.get("puerta", "Pórtico Principal")
    
    conn = get_db_connection()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    if tipo_acceso == "QR":
        if not codigo_qr:
            conn.close()
            return jsonify({"mensaje": "QR no proporcionado"}), 400
            
        # Validate QR code in db
        visitante = conn.execute("SELECT * FROM visitantes WHERE codigo_qr = ?", (codigo_qr,)).fetchone()
        if not visitante:
            conn.close()
            return jsonify({"mensaje": "QR invalido o inexistente", "acceso": "Denegado"}), 404
            
        exp_time = datetime.datetime.strptime(visitante["fecha_expiracion"], "%Y-%m-%d %H:%M:%S")
        if datetime.datetime.now() > exp_time or visitante["estado"] != "Autorizado":
            # Update status
            conn.execute("UPDATE visitantes SET estado = 'Expirado' WHERE id = ?", (visitante["id"],))
            conn.commit()
            conn.execute("INSERT INTO accesos (nombre_visitante, fecha_hora, tipo_acceso, estado, puerta) VALUES (?, ?, 'QR', 'Denegado', ?)",
                         (visitante["nombre"], now, puerta))
            conn.commit()
            conn.close()
            
            # Broadcast live access log
            broadcast_data({
                "type": "acceso",
                "visitante": visitante["nombre"],
                "fecha_hora": now,
                "tipo": "QR",
                "estado": "Denegado",
                "puerta": puerta
            })
            return jsonify({"mensaje": "Acceso QR expirado o inactivo", "acceso": "Denegado"})
            
        # Valid QR
        conn.execute("UPDATE visitantes SET estado = 'Usado' WHERE id = ?", (visitante["id"],))
        conn.execute("INSERT INTO accesos (nombre_visitante, fecha_hora, tipo_acceso, estado, puerta) VALUES (?, ?, 'QR', 'Autorizado', ?)",
                     (visitante["nombre"], now, puerta))
        conn.commit()
        conn.close()
        
        # Broadcast live access log
        broadcast_data({
            "type": "acceso",
            "visitante": visitante["nombre"],
            "fecha_hora": now,
            "tipo": "QR",
            "estado": "Autorizado",
            "puerta": puerta
        })
        return jsonify({"mensaje": f"Acceso Autorizado para {visitante['nombre']}", "acceso": "Autorizado"})
        
    else: # Biometric, Tag, PIN
        if not usuario_id:
            conn.close()
            return jsonify({"mensaje": "Usuario ID requerido"}), 400
            
        target_user = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
        if not target_user:
            conn.close()
            return jsonify({"mensaje": "Usuario no registrado"}), 404
            
        # Check if they are a resident and check outstanding balances (morosity rules)
        if target_user["rol"] == "Residente":
            unit = conn.execute("SELECT * FROM unidades WHERE residente_id = ?", (target_user["id"],)).fetchone()
            if unit and unit["saldo_actual"] > 900: # Threshold of debt (2 months or more)
                # Deny access to common areas or raise alert (Door remains locked for secondary gates)
                # But let's log the Denied access
                conn.execute("INSERT INTO accesos (usuario_id, fecha_hora, tipo_acceso, estado, puerta) VALUES (?, ?, ?, 'Denegado', ?)",
                             (target_user["id"], now, tipo_acceso, puerta))
                conn.commit()
                conn.close()
                broadcast_data({
                    "type": "acceso",
                    "visitante": target_user["nombre"],
                    "fecha_hora": now,
                    "tipo": tipo_acceso,
                    "estado": "Denegado",
                    "puerta": puerta,
                    "razon": "Morosidad excesiva"
                })
                return jsonify({"mensaje": "Acceso Denegado: Cuenta con restricciones de morosidad", "acceso": "Denegado"})
                
        # Authorized
        conn.execute("INSERT INTO accesos (usuario_id, fecha_hora, tipo_acceso, estado, puerta) VALUES (?, ?, ?, 'Autorizado', ?)",
                     (target_user["id"], now, tipo_acceso, puerta))
        conn.commit()
        conn.close()
        
        # Broadcast live access log
        broadcast_data({
            "type": "acceso",
            "visitante": target_user["nombre"],
            "fecha_hora": now,
            "tipo": tipo_acceso,
            "estado": "Autorizado",
            "puerta": puerta
        })
        return jsonify({"mensaje": f"Acceso Autorizado para {target_user['nombre']}", "acceso": "Autorizado"})

# Generate visitor QR code
@app.route("/api/v1/visitantes/qr", methods=["POST"])
@token_required
@roles_allowed("Residente")
def generar_qr(current_user):
    data = request.get_json() or {}
    nombre = data.get("nombre")
    documento = data.get("documento")
    motivo = data.get("motivo")
    
    if not nombre or not documento:
        return jsonify({"mensaje": "Nombre y documento requeridos"}), 400
        
    conn = get_db_connection()
    # Check if resident is morose (> $900)
    unit = conn.execute("SELECT * FROM unidades WHERE residente_id = ?", (current_user["id"],)).fetchone()
    if unit and unit["saldo_actual"] > 900:
        conn.close()
        return jsonify({"mensaje": "No puedes generar invitaciones debido a morosidad en la cuenta"}), 403
        
    # Generate unique QR code payload
    now = datetime.datetime.now()
    exp_time = (now + datetime.timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
    qr_code = f"QR_{current_user['id']}_{int(now.timestamp())}"
    
    conn.execute("""
        INSERT INTO visitantes (nombre, documento, motivo_visita, residente_id, codigo_qr, fecha_expiracion, estado)
        VALUES (?, ?, ?, ?, ?, ?, 'Autorizado')
    """, (nombre, documento, motivo, current_user["id"], qr_code, exp_time))
    
    conn.commit()
    conn.close()
    
    log_event(current_user["id"], "Generacion de QR", f"Residente creo QR para visitante {nombre}")
    return jsonify({
        "codigo_qr": qr_code,
        "fecha_expiracion": exp_time,
        "mensaje": "QR generado exitosamente por 24 horas."
    }), 201

# Telemetry Config
@app.route("/api/v1/telemetria/config", methods=["GET"])
@token_required
def get_telemetria_config(current_user):
    conn = get_db_connection()
    configs = conn.execute("SELECT parametro, valor FROM configuracion_sistema").fetchall()
    conn.close()
    return jsonify({row["parametro"]: row["valor"] for row in configs})

@app.route("/api/v1/telemetria/config", methods=["POST"])
@token_required
@roles_allowed("Administrador", "Tecnico")
def save_telemetria_config(current_user):
    data = request.get_json() or {}
    presion_min = data.get("presion_minima")
    presion_max = data.get("presion_maxima")
    
    conn = get_db_connection()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    if presion_min:
        conn.execute("INSERT OR REPLACE INTO configuracion_sistema (parametro, valor, fecha_actualizacion) VALUES ('presion_minima', ?, ?)", (str(presion_min), now))
    if presion_max:
        conn.execute("INSERT OR REPLACE INTO configuracion_sistema (parametro, valor, fecha_actualizacion) VALUES ('presion_maxima', ?, ?)", (str(presion_max), now))
        
    conn.commit()
    conn.close()
    
    log_event(current_user["id"], "Configuracion telemetria", f"Se actualizaron los umbrales de presion: Min={presion_min}, Max={presion_max}")
    return jsonify({"mensaje": "Configuracion guardada correctamente"})

# Trigger pump failure or simulation leak
@app.route("/api/v1/telemetria/simular", methods=["POST"])
@token_required
@roles_allowed("Administrador", "Tecnico")
def simular_telemetria(current_user):
    data = request.get_json() or {}
    leak = data.get("leak", False)
    bomba = data.get("bomba", "Nominal") # 'Nominal' or 'Fallo'
    
    simulation_state["leak_simulated"] = leak
    simulation_state["bomba_norte_estado"] = bomba
    
    conn = get_db_connection()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("INSERT OR REPLACE INTO configuracion_sistema (parametro, valor, fecha_actualizacion) VALUES ('bomba_norte_estado', ?, ?)", (bomba, now))
    conn.commit()
    conn.close()
    
    detalles = f"Simulacion: Bomba={bomba}, Fuga={leak}"
    log_event(current_user["id"], "Simulacion de telemetria", detalles)
    
    return jsonify({"mensaje": "Simulacion de estado de telemetria actualizada", "estado": simulation_state})

# Get bitacora
@app.route("/api/v1/auditoria/bitacora", methods=["GET"])
@token_required
@roles_allowed("Administrador")
def get_bitacora(current_user):
    conn = get_db_connection()
    logs = conn.execute("""
        SELECT b.*, u.nombre as usuario_nombre, u.rol as usuario_rol 
        FROM bitacora b 
        LEFT JOIN usuarios u ON b.usuario_id = u.id 
        ORDER BY b.id DESC 
        LIMIT 200
    """).fetchall()
    conn.close()
    return jsonify([dict(l) for l in logs])

# Get residents (Admin)
@app.route("/api/v1/usuarios", methods=["GET"])
@token_required
@roles_allowed("Administrador")
def get_usuarios(current_user):
    conn = get_db_connection()
    usuarios = conn.execute("SELECT id, nombre, correo, rol, telefono FROM usuarios ORDER BY nombre ASC").fetchall()
    conn.close()
    return jsonify([dict(u) for u in usuarios])

@app.route("/api/v1/usuarios", methods=["POST"])
@token_required
@roles_allowed("Administrador")
def add_usuario(current_user):
    data = request.get_json() or {}
    nombre = data.get("nombre")
    correo = data.get("correo")
    password = data.get("password")
    rol = data.get("rol")
    telefono = data.get("telefono")
    
    if not nombre or not correo or not password or not rol:
        return jsonify({"mensaje": "Campos obligatorios faltantes"}), 400
        
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO usuarios (nombre, correo, password_crypted, rol, telefono)
            VALUES (?, ?, ?, ?, ?)
        """, (nombre, correo, password_hash, rol, telefono))
        
        # If resident, create a unit association automatically
        if rol == "Residente":
            num_apartamiento = data.get("numero_apartamento")
            alicuota = data.get("alicuota", 0.2)
            if num_apartamiento:
                cursor.execute("""
                    INSERT INTO unidades (numero_apartamento, residente_id, saldo_actual, alicuota)
                    VALUES (?, ?, 0.0, ?)
                """, (num_apartamiento, cursor.lastrowid, float(alicuota)))
                
        conn.commit()
        log_event(current_user["id"], "Creacion de usuario", f"Admin creo usuario {nombre} con rol {rol}")
        return jsonify({"mensaje": "Usuario creado exitosamente"}), 201
    except sqlite3.IntegrityError:
        return jsonify({"mensaje": "El correo o apartamento ya esta registrado"}), 400
    finally:
        conn.close()

# Get raw DB table data (Admin only)
@app.route("/api/v1/auditoria/db", methods=["GET"])
@token_required
@roles_allowed("Administrador")
def get_db_table(current_user):
    table = request.args.get("table")
    allowed_tables = ['usuarios', 'unidades', 'pagos', 'egresos', 'accesos', 'telemetria', 'configuracion_sistema', 'bitacora', 'visitantes']
    if table not in allowed_tables:
        return jsonify({"mensaje": "Tabla no permitida"}), 400
    conn = get_db_connection()
    rows = conn.execute(f"SELECT * FROM {table}").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

# ----------------- WEBSOCKET SERVER -----------------

async def ws_handler(websocket):
    ws_clients.add(websocket)
    try:
        async for message in websocket:
            pass # Keep alive, no client-to-server WS actions needed for now
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        ws_clients.remove(websocket)

async def ws_server_init():
    async with websockets.serve(ws_handler, "0.0.0.0", 5001):
        await asyncio.Future() # run forever

# Background task for Telemetry Simulation loop
async def telemetry_simulator_loop():
    import random
    while True:
        # Update pressure depending on state
        if simulation_state["bomba_norte_estado"] == "Fallo":
            simulation_state["presion_psi"] = max(8.0, simulation_state["presion_psi"] - random.uniform(2.0, 5.0))
        elif simulation_state["leak_simulated"]:
            simulation_state["presion_psi"] = max(20.0, simulation_state["presion_psi"] - random.uniform(1.0, 3.0))
        else:
            # Nominal state, slight fluctuation around 44-46
            target = 44.5
            diff = target - simulation_state["presion_psi"]
            simulation_state["presion_psi"] += diff * 0.1 + random.uniform(-0.5, 0.5)
            # Bound pressure
            simulation_state["presion_psi"] = max(30.0, min(60.0, simulation_state["presion_psi"]))
        
        # Push readings to DB periodically (every 60s in real life, every 5s in demo)
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Check thresholds
        conn = get_db_connection()
        p_min = float(conn.execute("SELECT valor FROM configuracion_sistema WHERE parametro = 'presion_minima'").fetchone()["valor"])
        conn.close()
        
        is_alerta = False
        if simulation_state["presion_psi"] < p_min:
            is_alerta = True
            alert_type = "Baja Presion"
            severity = "Critico" if simulation_state["presion_psi"] < p_min * 0.5 else "Advertencia"
            
            # Record telemetry in DB
            conn = get_db_connection()
            conn.execute("INSERT INTO telemetria (presion_psi, timestamp, bomba_estado) VALUES (?, ?, ?)",
                         (simulation_state["presion_psi"], now_str, simulation_state["bomba_norte_estado"]))
            
            # Add alert event to DB if not already logged recently
            last_alert = conn.execute("SELECT * FROM bitacora WHERE accion = 'Alerta de Telemetria' ORDER BY id DESC LIMIT 1").fetchone()
            log_new_alert = True
            if last_alert:
                last_time = datetime.datetime.strptime(last_alert["timestamp"], "%Y-%m-%d %H:%M:%S")
                # Wait 15s between logs
                if (datetime.datetime.now() - last_time).total_seconds() < 15:
                    log_new_alert = False
            
            if log_new_alert:
                conn.execute(
                    "INSERT INTO bitacora (usuario_id, accion, detalles, timestamp) VALUES (NULL, 'Alerta de Telemetria', ?, ?)",
                    (f"Presion critica detectada: {simulation_state['presion_psi']:.1f} PSI (Umbral: {p_min} PSI). Estado Bomba: {simulation_state['bomba_norte_estado']}", now_str)
                )
                conn.execute(
                    "INSERT INTO visitantes (nombre, documento, motivo_visita, residente_id, codigo_qr, fecha_expiracion, estado) VALUES ('SYSTEM', 'SYSTEM', 'SYSTEM', 1, 'SYSTEM', 'SYSTEM', 'Expirado') ON CONFLICT DO NOTHING"
                ) # Stub for logs
                
                # Mock Whatsapp/Telegram Notification dispatch
                conn.execute("""
                    INSERT INTO pagos (unidad_id, monto, fecha, referencia, metodo, concepto, estado) 
                    VALUES (1, 0, ?, 'SYSTEM', 'Alerta', ?, 'Pagado')
                """, (now_str, f"WhatsApp enviado: Alerta hídrica {severity} - Presión en {simulation_state['presion_psi']:.1f} PSI"))
                conn.commit()
                
            conn.commit()
            conn.close()
            
        # Send WS broadcast
        broadcast_data({
            "type": "telemetria",
            "presion_psi": round(simulation_state["presion_psi"], 1),
            "timestamp": now_str,
            "bomba_estado": simulation_state["bomba_norte_estado"],
            "leak": simulation_state["leak_simulated"],
            "alerta": is_alerta
        })
        
        await asyncio.sleep(2)

def start_async_loop(loop):
    asyncio.set_event_loop(loop)
    # Gather both WS server and Telemetry loop
    loop.run_until_complete(asyncio.gather(
        ws_server_init(),
        telemetry_simulator_loop()
    ))

if __name__ == "__main__":
    # Start WS server and telemetry loop in separate thread
    loop = asyncio.new_event_loop()
    t = threading.Thread(target=start_async_loop, args=(loop,), daemon=True)
    t.start()
    
    # Start Flask app on port 5000
    print("Starting Flask Web Server on http://localhost:5000")
    print("Starting WebSocket Server on ws://localhost:5001")
    app.run(host="0.0.0.0", port=5000, debug=False)
